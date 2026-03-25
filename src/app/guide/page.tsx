export default function GuidePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">怎麼用？</h1>
        <p className="text-stone-400 text-sm mt-1">
          第一次來？花 2 分鐘看完就上手！
        </p>
      </div>

      {/* ① 這是什麼 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2">
          <span className="mr-2">&#x1F35C;</span>這是什麼？
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          這是我們部門專屬的<strong>團體訂餐 & 付款追蹤</strong>工具！
          <br />
          團主開一張訂單，大家填餐點，系統自動統計品項和金額，還能追蹤誰付了錢、誰還沒付。
        </p>
      </div>

      {/* ② 兩種角色 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-3">
          <span className="mr-2">&#x1F465;</span>兩種角色
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 rounded-xl p-4 text-center">
            <div className="text-3xl mb-2">&#x1F451;</div>
            <p className="font-semibold text-emerald-700 text-sm">團主</p>
            <p className="text-xs text-emerald-600 mt-1 leading-relaxed">
              開訂單、統計品項
              <br />
              收錢、核銷帳務
            </p>
          </div>
          <div className="bg-amber-50 rounded-xl p-4 text-center">
            <div className="text-3xl mb-2">&#x1F37D;&#xFE0F;</div>
            <p className="font-semibold text-amber-700 text-sm">訂餐的人</p>
            <p className="text-xs text-amber-600 mt-1 leading-relaxed">
              填寫餐點、付錢
              <br />
              標記已轉帳
            </p>
          </div>
        </div>
        <p className="text-xs text-stone-400 mt-3 text-center">
          任何人都可以當團主，每次由一位自願者負責就好～
        </p>
      </div>

      {/* ③ 訂餐流程 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-4">
          <span className="mr-2">&#x1F4CB;</span>訂餐流程
        </h2>
        <div className="space-y-0">
          <Step
            number={1}
            emoji="&#x1F4E2;"
            title="團主開單"
            desc="按「開新訂單」，填寫標題、銀行收款資訊（可上傳 QR Code）、上傳菜單圖片"
          />
          <StepArrow />
          <Step
            number={2}
            emoji="&#x1F4E5;"
            title="預先輸入訂單（選填）"
            desc="團主可以先幫大家輸入訂單：用「轉錄匯入」貼上接龍文字，或按「手動新增」一筆一筆輸入"
          />
          <StepArrow />
          <Step
            number={3}
            emoji="&#x1F517;"
            title="分享連結"
            desc="把場次連結分享到群組，大家可以看菜單圖片、點進去填餐"
          />
          <StepArrow />
          <Step
            number={4}
            emoji="&#x270F;&#xFE0F;"
            title="大家填餐"
            desc="輸入名字、品項、價格，按送出訂單（場次頁也可以再轉錄匯入）"
          />
          <StepArrow />
          <Step
            number={5}
            emoji="&#x1F512;"
            title="團主關閉訂餐"
            desc="收集完畢後按「關閉訂餐」，系統自動統計"
          />
          <StepArrow />
          <Step
            number={6}
            emoji="&#x1F4CB;"
            title="複製摘要去訂餐"
            desc="按「複製摘要」，可以直接複製內容方便貼給店家的 LINE"
            isLast
          />
        </div>
        <div className="bg-stone-50 rounded-xl p-3 mt-3 space-y-1.5">
          <p className="text-xs font-medium text-stone-500">轉錄匯入支援的格式：</p>
          <p className="text-xs text-stone-400">&#x2022; 接龍格式：每行「姓名 品項 價格」</p>
          <p className="text-xs text-stone-400">&#x2022; 外部平台：支援「你訂」及餐盒平台（含「N 份餐點 / $XXX」格式），需要其他平台可以到回報問題跟我說～</p>
          <p className="text-xs text-stone-400">&#x2022; 多餘空格、$符號、編號等系統都會自動處理，解析後可逐筆修改</p>
        </div>
        <p className="text-xs text-stone-400 mt-3 text-center">
          標題、負責人、收款帳戶、QR Code、菜單圖片都可以隨時點「編輯」修改～
        </p>
      </div>

      {/* ④ 付款流程 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-4">
          <span className="mr-2">&#x1F4B0;</span>付款流程
        </h2>
        <div className="space-y-0">
          <Step
            number={1}
            emoji="&#x1F4F1;"
            title="查看要付多少"
            desc="到「付款追蹤」頁，看自己欠誰多少錢"
          />
          <StepArrow />
          <Step
            number={2}
            emoji="&#x1F3E6;"
            title="轉帳給團主"
            desc="用銀行帳號、QR Code 或轉帳連結付款（可點「複製帳號」一鍵複製）"
          />
          <StepArrow />
          <Step
            number={3}
            emoji="&#x2705;"
            title="按「我已轉帳」"
            desc="轉完帳後記得回來按一下，讓團主知道（團主也可以直接確認收到）"
          />
          <StepArrow />
          <Step
            number={4}
            emoji="&#x1F389;"
            title="團主按「確認收到」"
            desc="團主確認收到錢後按一下，帳務就核銷完成啦！"
            isLast
          />
        </div>
      </div>

      {/* ⑤ 資料存放 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2">
          <span className="mr-2">&#x1F4CA;</span>資料都存在哪裡？
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          所有訂餐紀錄、付款狀態都存在 Google Sheet 上，公開透明！
          <br />
          核銷完成的帳務也會<strong>保留三個月</strong>，有疑問隨時可以回去查。
        </p>
        <a
          href="https://docs.google.com/spreadsheets/d/1IvKJrHkftAQ9Iyaf9p4iQ82GruIA_JHoWcIPKIR9TzU/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium active:bg-emerald-700"
        >
          <span>&#x1F4C4;</span>
          查看 Google Sheet
        </a>
      </div>

      {/* ⑥ 回報問題 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2">
          <span className="mr-2">&#x1F4E3;</span>遇到問題？
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          到「回報問題」分頁，選擇問題類型、描述狀況，還可以
          <strong>上傳截圖</strong>
          幫助我更快找到問題！
        </p>
      </div>

      {/* ⑦ 信任制提醒 */}
      <div className="bg-amber-50 rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2 text-amber-700">
          <span className="mr-2">&#x1F91D;</span>信任制小提醒
        </h2>
        <p className="text-sm text-amber-600 leading-relaxed">
          這個 app
          <strong>沒有登入系統</strong>
          ，靠的是大家的信任運作～
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-amber-600">
          <li>&#x1F6AB; 不要幫別人按「我已轉帳」</li>
          <li>&#x1F6AB; 不要幫別人按「確認收到」</li>
          <li>&#x1F6AB; 不是團主的話，不要亂按「關閉訂餐」</li>
          <li>
            &#x1F49B; 每個按鈕都有提醒，看到提醒記得確認是不是該你按的哦！
          </li>
        </ul>
      </div>
    </div>
  );
}

function Step({
  number,
  emoji,
  title,
  desc,
  isLast,
}: {
  number: number;
  emoji: string;
  title: string;
  desc: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold shrink-0">
          {number}
        </div>
        {!isLast && <div className="w-0.5 h-3 bg-transparent" />}
      </div>
      <div className="pb-1">
        <p className="font-medium text-sm">
          <span
            className="mr-1"
            dangerouslySetInnerHTML={{ __html: emoji }}
          />{" "}
          {title}
        </p>
        <p className="text-xs text-stone-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function StepArrow() {
  return (
    <div className="flex items-center ml-[15px] py-0.5">
      <div className="w-0.5 h-4 bg-emerald-200 rounded-full" />
    </div>
  );
}
