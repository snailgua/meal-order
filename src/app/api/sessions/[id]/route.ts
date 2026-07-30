import { NextResponse } from "next/server";
import {
  applyAtomicSheetMutations,
  getRows,
  type AtomicSheetMutation,
} from "@/lib/sheets";
import { planReconcilePayments } from "@/lib/reconcilePayments";
import {
  hasPaymentConfirmation,
  isSettledPayment,
} from "@/lib/paymentRules";
import {
  idempotencyKey,
  optionalText,
  requiredText,
} from "@/lib/inputValidation";
import {
  ResourceBusyError,
  withResourceLock,
} from "@/lib/resourceLock";
import { sheetWritesPaused } from "@/lib/maintenance";
import { decideSessionMutation } from "@/lib/sessionVersion";

export const maxDuration = 60;

// 訂單明細表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID
//
// 付款追蹤表 column layout:
// [0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額
// [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間
// [11]付款人標記時間 [12]訂單ID

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await getRows("訂餐場次表");
    const row = rows.slice(1).find((r) => r[0] === id);

    if (!row) {
      return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
    }

    return NextResponse.json({
      id: row[0],
      date: row[1],
      title: row[2],
      organizer: row[3],
      bankName: row[4],
      bankAccount: row[5],
      qrCodeUrl: row[6] || "",
      transferLink: row[7] || "",
      menuImages: row[10] ? row[10].split(",") : [],
      status: row[8],
      createdAt: row[9],
      version: row[11] || "",
    });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return NextResponse.json({ error: "無法載入場次資訊" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const requestId = idempotencyKey(body.requestId);
    const expectedVersion =
      body.expectedVersion === ""
        ? ""
        : idempotencyKey(body.expectedVersion);
    if (!requestId || expectedVersion === null) {
      return NextResponse.json(
        { error: "缺少有效的 requestId 或場次版本" },
        { status: 400 }
      );
    }
    return await withResourceLock(`session:${id}`, async () => {
      const rows = await getRows("訂餐場次表");
      const dataIndex = rows.findIndex((r, i) => i > 0 && r[0] === id);

      if (dataIndex === -1) {
        return NextResponse.json({ error: "找不到此場次" }, { status: 404 });
      }

      const row = [...rows[dataIndex]];
      const currentVersion = row[11] || "";
      const versionDecision = decideSessionMutation(
        currentVersion,
        expectedVersion,
        requestId
      );
      if (versionDecision === "replay") {
        return NextResponse.json({
          success: true,
          version: currentVersion,
          replayed: true,
        });
      }
      if (versionDecision === "conflict") {
        return NextResponse.json(
          {
            error: "場次已被其他人更新，請重新整理後再試",
            version: currentVersion,
          },
          { status: 409 }
        );
      }
      const hasOwn = (key: string) =>
        Object.prototype.hasOwnProperty.call(body, key);
      const infoKeys = [
        "title",
        "organizer",
        "bankName",
        "bankAccount",
        "qrCodeUrl",
        "transferLink",
        "menuImages",
      ];
      const hasInfoUpdate = infoKeys.some(hasOwn);

      if (hasInfoUpdate) {
        const title = hasOwn("title") ? requiredText(body.title) : undefined;
        const organizer = hasOwn("organizer")
          ? requiredText(body.organizer)
          : undefined;
        const bankName = hasOwn("bankName")
          ? requiredText(body.bankName)
          : undefined;
        const bankAccount = hasOwn("bankAccount")
          ? requiredText(body.bankAccount)
          : undefined;
        const qrCodeUrl = hasOwn("qrCodeUrl")
          ? optionalText(body.qrCodeUrl)
          : undefined;
        const transferLink = hasOwn("transferLink")
          ? optionalText(body.transferLink)
          : undefined;
        const menuImages =
          hasOwn("menuImages") &&
          typeof body.menuImages === "string" &&
          body.menuImages.length <= 40_000 &&
          body.menuImages.split(",").filter(Boolean).length <= 20
            ? body.menuImages
            : hasOwn("menuImages")
              ? null
              : undefined;

        if (
          (hasOwn("title") && !title) ||
          (hasOwn("organizer") && !organizer) ||
          (hasOwn("bankName") && !bankName) ||
          (hasOwn("bankAccount") && !bankAccount) ||
          qrCodeUrl === null ||
          transferLink === null ||
          menuImages === null
        ) {
          return NextResponse.json(
            { error: "場次資料格式不正確" },
            { status: 400 }
          );
        }

        const nextTitle = title ?? undefined;
        const nextOrganizer = organizer ?? undefined;
        const nextBankName = bankName ?? undefined;
        const nextBankAccount = bankAccount ?? undefined;
        const nextQrCodeUrl = qrCodeUrl ?? undefined;
        const nextTransferLink = transferLink ?? undefined;
        const nextMenuImages = menuImages ?? undefined;
        const organizerChanged =
          nextOrganizer !== undefined && nextOrganizer !== row[3];
        const organizerRequested = nextOrganizer !== undefined;
        const needsRelatedRows = nextTitle !== undefined || organizerRequested;
        const [orderRows, paymentRows] = needsRelatedRows
          ? await Promise.all([
              getRows("訂單明細表"),
              getRows("付款追蹤表"),
            ])
          : [[], []];

        const confirmedReceiverConflict =
          organizerRequested &&
          paymentRows.some(
            (payment) =>
              payment[0] === id &&
              payment[1] !== "__ARCHIVED_PAYMENT__" &&
              payment[4] !== nextOrganizer &&
              hasPaymentConfirmation(payment)
          );
        if (
          (organizerChanged &&
            paymentRows.some(
              (payment) =>
                payment[0] === id && hasPaymentConfirmation(payment)
            )) ||
          confirmedReceiverConflict
        ) {
          return NextResponse.json(
            {
              error:
                "此場次已有付款進度，為保留正確收款紀錄，不能再更換負責人",
            },
            { status: 409 }
          );
        }

        const sessionUpdates: { col: number; value: string }[] = [];
        const setSessionCell = (col: number, value: string | undefined) => {
          if (value !== undefined && row[col] !== value) {
            row[col] = value;
            sessionUpdates.push({ col, value });
          }
        };
        setSessionCell(2, nextTitle);
        setSessionCell(3, nextOrganizer);
        setSessionCell(4, nextBankName);
        setSessionCell(5, nextBankAccount);
        setSessionCell(6, nextQrCodeUrl);
        setSessionCell(7, nextTransferLink);
        setSessionCell(10, nextMenuImages);
        setSessionCell(11, requestId);
        const mutations: AtomicSheetMutation[] = [];
        if (sessionUpdates.length > 0) {
          mutations.push({
            type: "updateCells",
            sheetName: "訂餐場次表",
            rowNumber: dataIndex + 1,
            updates: sessionUpdates,
          });
        }

        if (needsRelatedRows) {
          const projectedOrderRows = orderRows.map((orderRow) => [
            ...orderRow,
          ]);
          const projectedPaymentRows = paymentRows.map((paymentRow) => [
            ...paymentRow,
          ]);

          for (let i = 1; i < orderRows.length; i++) {
            if (orderRows[i][0] !== id) continue;
            const updates: { col: number; value: string }[] = [];
            if (nextTitle !== undefined && orderRows[i][2] !== nextTitle) {
              updates.push({ col: 2, value: nextTitle });
              projectedOrderRows[i][2] = nextTitle;
            }
            if (organizerRequested && orderRows[i][3] !== nextOrganizer) {
              updates.push({ col: 3, value: nextOrganizer! });
              projectedOrderRows[i][3] = nextOrganizer!;
            }
            if (updates.length > 0) {
              mutations.push({
                type: "updateCells",
                sheetName: "訂單明細表",
                rowNumber: i + 1,
                updates,
              });
            }
          }

          // 已核銷付款是不可變的稽核紀錄（包含精簡 archive marker）；
          // 標題只同步到尚未核銷的付款，收款人交給 reconcile 規劃。
          if (nextTitle !== undefined) {
            for (let i = 1; i < paymentRows.length; i++) {
              if (
                paymentRows[i][0] === id &&
                !isSettledPayment(paymentRows[i]) &&
                paymentRows[i][2] !== nextTitle
              ) {
                projectedPaymentRows[i][2] = nextTitle;
                mutations.push({
                  type: "updateCells",
                  sheetName: "付款追蹤表",
                  rowNumber: i + 1,
                  updates: [{ col: 2, value: nextTitle }],
                });
              }
            }
          }
          if (organizerRequested) {
            mutations.push(
              ...planReconcilePayments(
                id,
                row,
                projectedOrderRows,
                projectedPaymentRows,
                {
                  // organizer 沒變的重送只修復既有列，不可把已清理的
                  // 歷史欠款重新建回來。
                  createMissing:
                    organizerChanged && row[8] === "已關閉",
                  // 換團主是「刪一列、補一列」的成對操作，連超過保留期的
                  // 舊場次也必須允許補建，否則舊團主該付的錢會憑空不見。
                  allowArchivedCreate: organizerChanged,
                }
              )
            );
          }
        }
        await applyAtomicSheetMutations(mutations);

        return NextResponse.json({
          success: true,
          version: requestId,
          replayed: false,
        });
      }

      if (body.status === "已關閉") {
        const [orderRows, paymentRows] = await Promise.all([
          getRows("訂單明細表"),
          getRows("付款追蹤表"),
        ]);
        const mutations = planReconcilePayments(
          id,
          row,
          orderRows,
          paymentRows,
          {
            // 只有真正從開放切到關閉時可以為久未結帳的場次建帳；
            // 已關閉請求的重送不可重建已依保留政策清掉的舊欠款。
            allowArchivedCreate: row[8] !== "已關閉",
          }
        );
        const statusUpdates = [{ col: 11, value: requestId }];
        if (row[8] !== "已關閉") {
          row[8] = "已關閉";
          statusUpdates.unshift({ col: 8, value: "已關閉" });
        }
        mutations.push({
          type: "updateCells",
          sheetName: "訂餐場次表",
          rowNumber: dataIndex + 1,
          updates: statusUpdates,
        });
        // 對帳與狀態切換一起提交，避免任一 Sheet 留下半套狀態。
        await applyAtomicSheetMutations(mutations);
      } else if (body.status === "開放中") {
        const statusUpdates = [{ col: 11, value: requestId }];
        if (row[8] !== "開放中") {
          row[8] = "開放中";
          statusUpdates.unshift({ col: 8, value: "開放中" });
        }
        await applyAtomicSheetMutations([
          {
            type: "updateCells",
            sheetName: "訂餐場次表",
            rowNumber: dataIndex + 1,
            updates: statusUpdates,
          },
        ]);
        // 不刪付款列。未確認列在付款 GET 會於開放中隱藏，重新關閉時
        // reconcile 會重用；已付款列則保留給團主完成核銷。
      } else {
        return NextResponse.json({ error: "沒有可更新的欄位" }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        version: requestId,
        replayed: false,
      });
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to update session:", error);
    return NextResponse.json({ error: "更新場次失敗" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (sheetWritesPaused()) {
    return NextResponse.json(
      { error: "系統正在進行資料維護，暫停寫入" },
      { status: 503 }
    );
  }
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const expectedVersion =
      searchParams.get("expectedVersion") === ""
        ? ""
        : idempotencyKey(searchParams.get("expectedVersion"));
    if (expectedVersion === null) {
      return NextResponse.json(
        { error: "缺少有效的場次版本" },
        { status: 400 }
      );
    }
    return await withResourceLock(`session:${id}`, async () => {
      const [paymentRows, orderRows, sessionRows] = await Promise.all([
        getRows("付款追蹤表"),
        getRows("訂單明細表"),
        getRows("訂餐場次表"),
      ]);
      const mutations: AtomicSheetMutation[] = [];
      const sessionIndex = sessionRows.findIndex(
        (sessionRow, index) => index > 0 && sessionRow[0] === id
      );
      if (sessionIndex === -1) {
        return NextResponse.json({ success: true, replayed: true });
      }
      if ((sessionRows[sessionIndex][11] || "") !== expectedVersion) {
        return NextResponse.json(
          { error: "場次已被其他人更新，請重新整理後再刪除" },
          { status: 409 }
        );
      }
      for (let i = 1; i < paymentRows.length; i++) {
        if (paymentRows[i][0] === id) {
          mutations.push({
            type: "tombstoneRow",
            sheetName: "付款追蹤表",
            rowNumber: i + 1,
          });
        }
      }
      for (let i = 1; i < orderRows.length; i++) {
        if (orderRows[i][0] === id) {
          mutations.push({
            type: "tombstoneRow",
            sheetName: "訂單明細表",
            rowNumber: i + 1,
          });
        }
      }
      mutations.push({
        type: "tombstoneRow",
        sheetName: "訂餐場次表",
        rowNumber: sessionIndex + 1,
        key: id,
      });
      await applyAtomicSheetMutations(mutations);

      return NextResponse.json({ success: true });
    });
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      return NextResponse.json(
        { error: "此場次正在處理其他操作，請稍後再試" },
        { status: 503, headers: { "Retry-After": "2" } }
      );
    }
    console.error("Failed to delete session:", error);
    return NextResponse.json({ error: "刪除場次失敗" }, { status: 500 });
  }
}
