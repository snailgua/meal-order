export interface ParsedOrder {
  name: string;
  item: string;
  price: number;
  note: string;
}

export interface ParseResult {
  orders: ParsedOrder[];
  failedLines: string[];
}

function parseExternalPlatform(text: string): ParsedOrder[] {
  const orders: ParsedOrder[] = [];
  const blocks = text
    .split(/＋收款/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    let name = "";
    let price = 0;
    let item = "";
    let comment = "";
    let details = "";

    for (const line of lines) {
      if (line.includes("訂購人姓名")) {
        const m = line.match(/訂購人姓名[：:]\s*(.+)/);
        if (m) name = m[1].trim();
      } else if (/^\$\d+/.test(line) && line.includes("份")) {
        const m = line.match(/^\$(\d+)/);
        if (m) price = parseInt(m[1]);
      } else if (
        /\.\s*$/.test(line) &&
        line.length < 30 &&
        !line.includes("/")
      ) {
        item = line.replace(/\.\s*$/, "").trim();
      } else if (/^留言[：:]/.test(line)) {
        comment = line.replace(/^留言[：:]\s*/, "").trim();
      } else if (line.includes("/") && /\$\d+/.test(line)) {
        const m = line.match(/^(.+?)\/\s*\$\d+\s*\/\s*\d+份\s*$/);
        if (m) details = m[1].replace(/\/\s*$/, "").trim();
      }
    }

    if (!name) {
      for (const line of lines) {
        if (
          !line.startsWith("$") &&
          !/\.\s*$/.test(line) &&
          !line.includes("/") &&
          !/^留言[：:]/.test(line) &&
          !line.includes("訂購人") &&
          !line.includes("account_circle") &&
          !/^\d{8,}$/.test(line)
        ) {
          name = line.trim();
          break;
        }
      }
    }

    if (name && price > 0) {
      const noteParts: string[] = [];
      if (details) noteParts.push(details);
      if (comment) noteParts.push(comment);
      orders.push({
        name,
        item: item || "未指定",
        price,
        note: noteParts.join("; "),
      });
    }
  }

  return orders;
}

export function parseTranscriptText(text: string): ParseResult {
  // 自動偵測外部訂餐平台格式（含「＋收款」或「$XXX / N 份」）
  if (text.includes("＋收款") || /\$\d+\s*\/\s*\d+\s*份/.test(text)) {
    const platformOrders = parseExternalPlatform(text);
    if (platformOrders.length > 0) {
      return { orders: platformOrders, failedLines: [] };
    }
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const orders: ParsedOrder[] = [];
  const failedLines: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine;

    // 1. 移除行首編號（例如 "1." "1、" "1:" "1)" "#1"）
    line = line.replace(/^[#＃]?\d+[.、:：)\]）】]\s*/, "");

    // 2. 全形空格轉半形、全形數字轉半形
    line = line.replace(/\u3000/g, " ");
    line = line.replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)
    );

    // 3. 統一分隔符號
    line = line.replace(/[：:—–|／,，]\s*/g, " ");

    // 4. 移除價格的 $ ＄ NT NT$ 前綴
    line = line.replace(/(?:NT\$?|＄|\$)\s*(\d+)/gi, "$1");

    // 5. 移除「元」「塊」後綴
    line = line.replace(/(\d+)\s*[元塊]/, "$1");

    // 6. 用空白分割
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < 3) {
      failedLines.push(rawLine);
      continue;
    }

    const name = tokens[0];

    // 從最後面找價格（純數字的 token）
    let priceIndex = -1;
    for (let i = tokens.length - 1; i >= 2; i--) {
      if (/^\d+$/.test(tokens[i])) {
        priceIndex = i;
        break;
      }
    }
    if (priceIndex < 2) {
      failedLines.push(rawLine);
      continue;
    }

    const item = tokens.slice(1, priceIndex).join(" ");
    const price = Number(tokens[priceIndex]);

    // priceIndex 之後的 token 當作備註
    const note = tokens.slice(priceIndex + 1).join(" ");

    orders.push({ name, item, price, note });
  }

  return { orders, failedLines };
}
