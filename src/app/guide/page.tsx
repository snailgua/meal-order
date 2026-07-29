export default function GuidePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">怎麼用？</h1>
        <p className="text-stone-400 text-sm mt-1">
          花 1 分鐘看完就上手！
        </p>
      </div>

      {/* ① 這是什麼 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2">
          <span className="mr-2">&#x1F35C;</span>這是什麼？
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          這是我們部門專屬的<strong>對帳工具</strong>！
          <br />
          點餐照舊在 LINE 接龍，訂完之後團主把接龍內容丟進來，系統就會自動算好
          <strong>誰欠團主多少錢</strong>，大家轉帳、核銷一目瞭然，不再漏帳。
        </p>
      </div>

      {/* ② 團主怎麼用 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-4">
          <span className="mr-2">&#x1F451;</span>團主：3 步驟建好帳單
        </h2>
        <div className="space-y-0">
          <Step
            number={1}
            emoji="&#x1F4E2;"
            title="開新訂單"
            desc="在「今日訂餐」按「開新訂單」，填標題和收款帳戶（可上傳 QR Code）"
          />
          <StepArrow />
          <Step
            number={2}
            emoji="&#x1F4E5;"
            title="把 LINE 接龍丟進來"
            desc="直接貼上接龍文字或上傳截圖，AI 自動辨識成訂單，可逐筆修改；也可以手動一筆筆輸入"
          />
          <StepArrow />
          <Step
            number={3}
            emoji="&#x2728;"
            title="按「建立場次」就完成"
            desc="系統自動產生對帳清單，把「付款追蹤」頁分享到群組，等大家轉帳就好"
            isLast
          />
        </div>
        <p className="text-xs text-stone-400 mt-3 text-center">
          收款帳戶、QR Code 之後都可以隨時修改～
        </p>
      </div>

      {/* ③ 大家怎麼付錢 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-4">
          <span className="mr-2">&#x1F4B0;</span>大家：3 步驟還錢
        </h2>
        <div className="space-y-0">
          <Step
            number={1}
            emoji="&#x1F4F1;"
            title="看自己欠多少"
            desc="到「付款追蹤」頁找自己的名字，看要付誰、付多少"
          />
          <StepArrow />
          <Step
            number={2}
            emoji="&#x1F3E6;"
            title="轉帳"
            desc="掃 QR Code 或按「複製帳號」轉帳給團主"
          />
          <StepArrow />
          <Step
            number={3}
            emoji="&#x2705;"
            title="按「我已轉帳」"
            desc="轉完記得按一下；團主確認收到後，這筆帳就核銷消失啦！"
            isLast
          />
        </div>
      </div>

      {/* ④ 信任制提醒 */}
      <div className="bg-amber-50 rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2 text-amber-700">
          <span className="mr-2">&#x1F91D;</span>信任制小提醒
        </h2>
        <p className="text-sm text-amber-600 leading-relaxed">
          這個 app <strong>沒有登入系統</strong>，靠的是大家的信任運作～
          <br />
          「我已轉帳」「確認收到」只按自己該按的那顆，按錯了帳就亂了哦！
        </p>
      </div>

      {/* ⑤ 資料存放 */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-semibold text-lg mb-2">
          <span className="mr-2">&#x1F4CA;</span>資料都存在哪裡？
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          所有紀錄都存在 Google Sheet 上，公開透明！核銷完的帳也會
          <strong>保留三個月</strong>，有疑問隨時回去查。
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
          到「回報問題」分頁描述狀況（可以附截圖），我會盡快處理！
        </p>
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
