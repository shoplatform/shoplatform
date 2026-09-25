/* =========================================================
 * seed.js — 範例資料
 * 第一次打開、或在「設定」按下「重置範例資料」時載入。
 * 商店「晨霧選物」是虛構的示範店家。
 * ========================================================= */
/* 示範帳號的密碼雜湊：sha256("demo-salt-u1:demo1234") */
window.DEMO_AUTH = { salt: "demo-salt-u1", hash: "b8feb5b66e49b5d1bb72da8463f27f98fb0562b151d5eeadf1f77f3b1d18f849", algo: "sha256" };

window.makeSeed = function () {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const iso = (daysAgo, hour) => {
    const d = new Date(now - daysAgo * day);
    d.setHours(hour || 14, 20, 0, 0);
    return d.toISOString();
  };

  // 產生多規格組合的小工具
  function variants(prefix, options, basePrice, stockFn) {
    const combos = options.reduce(
      (acc, opt) => acc.flatMap(c => opt.values.map(v => ({ ...c, [opt.name]: v }))),
      [{}]
    );
    return combos.map((opts, i) => ({
      id: prefix + "-v" + (i + 1),
      sku: prefix.toUpperCase() + "-" + String(i + 1).padStart(2, "0"),
      options: opts,
      price: basePrice,
      stock: stockFn ? stockFn(i) : 20,
    }));
  }

  const products = [
    {
      id: "p_cup", name: "手捏陶杯", status: "active", color: "#b7a38b",
      description: "每一只都是手捏成形，杯緣帶著些微不規則的弧度。容量約 250ml，可放洗碗機。",
      categoryIds: ["c_home"],
      options: [{ name: "釉色", values: ["霧白", "灰藍", "松綠"] }],
      variants: variants("cup", [{ name: "釉色", values: ["霧白", "灰藍", "松綠"] }], 680, i => [12, 3, 0][i]),
      createdAt: iso(40),
    },
    {
      id: "p_tee", name: "有機棉素T", status: "active", color: "#8a9a8e",
      description: "240g 厚磅有機棉，微寬版型，洗後不易變形。",
      categoryIds: ["c_wear"],
      options: [{ name: "顏色", values: ["白", "黑"] }, { name: "尺寸", values: ["S", "M", "L"] }],
      variants: variants("tee", [{ name: "顏色", values: ["白", "黑"] }, { name: "尺寸", values: ["S", "M", "L"] }], 890, i => [8, 15, 10, 4, 12, 9][i]),
      createdAt: iso(35),
    },
    {
      id: "p_apron", name: "亞麻工作圍裙", status: "active", color: "#6d7b86",
      description: "水洗亞麻，雙口袋設計，頸帶可調整長度。",
      categoryIds: ["c_wear", "c_home"],
      options: [{ name: "顏色", values: ["炭灰", "米白"] }],
      variants: variants("apron", [{ name: "顏色", values: ["炭灰", "米白"] }], 1280, i => [6, 2][i]),
      createdAt: iso(30),
    },
    {
      id: "p_candle", name: "雪松大豆蠟燭", status: "active", color: "#a58a6f",
      description: "天然大豆蠟，雪松與岩蘭草調，燃燒時間約 40 小時。",
      categoryIds: ["c_scent"],
      options: [],
      variants: [{ id: "candle-v1", sku: "CANDLE-01", options: {}, price: 750, stock: 25 }],
      createdAt: iso(22),
    },
    {
      id: "p_tote", name: "帆布托特包", status: "active", color: "#4f6b66",
      description: "12 安士厚帆布，內附小口袋，可裝 A4 文件與筆電。",
      categoryIds: ["c_wear"],
      options: [{ name: "顏色", values: ["原色", "墨綠"] }],
      variants: variants("tote", [{ name: "顏色", values: ["原色", "墨綠"] }], 590, i => [18, 7][i]),
      createdAt: iso(15),
    },
    {
      id: "p_cutlery", name: "胡桃木餐具組", status: "draft", color: "#7a5a43",
      description: "湯匙、叉子、筷子三件組，附收納布套。（草稿，尚未上架）",
      categoryIds: ["c_home"],
      options: [],
      variants: [{ id: "cutlery-v1", sku: "CUTLERY-01", options: {}, price: 480, stock: 30 }],
      createdAt: iso(3),
    },
  ];
  products.forEach(p => { p.images = []; });

  const customers = [
    { id: "u_1", name: "林雨潔", phone: "0912345678", email: "yuchieh@example.com", createdAt: iso(28) },
    { id: "u_2", name: "陳柏翰", phone: "0923456789", email: "pohan@example.com", createdAt: iso(20) },
    { id: "u_3", name: "王思妤", phone: "0934567890", email: "szuyu@example.com", createdAt: iso(9) },
    { id: "u_4", name: "張家豪", phone: "0945678901", email: "chiahao@example.com", createdAt: iso(2) },
  ];
  // 示範會員帳號：手機 0912345678、密碼 demo1234（其他人是結帳時自動建立、還沒開通帳號）
  customers[0].auth = window.DEMO_AUTH;
  customers[0].registeredAt = iso(27);

  function line(product, variantIdx, qty) {
    const p = products.find(x => x.id === product);
    const v = p.variants[variantIdx];
    return {
      productId: p.id, variantId: v.id, name: p.name,
      optionText: Object.values(v.options).join(" / "),
      sku: v.sku, price: v.price, qty,
    };
  }
  function order(no, customerId, items, shipId, status, daysAgo, extra) {
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const fee = subtotal >= 1200 ? 0 : (shipId === "home" ? 100 : 60);
    const c = customers.find(x => x.id === customerId);
    return Object.assign({
      id: "o_" + no, number: no, customerId,
      contact: { name: c.name, phone: c.phone, email: c.email },
      items, subtotal, shippingFee: fee, discount: 0, total: subtotal + fee,
      shipping: {
        methodId: shipId, methodName: { cvs711: "7-11 取貨", cvsfami: "全家取貨", home: "宅配到府" }[shipId],
        address: shipId === "home" ? "台中市西區公益路 100 號" : "", storeName: shipId === "home" ? "" : "中港門市",
        trackingNo: "",
      },
      payment: { methodId: "transfer", methodName: "銀行轉帳（人工對帳）", status: "unpaid" },
      status, note: "", createdAt: iso(daysAgo, 10 + (no.length % 8)),
      history: [{ status: "pending_payment", at: iso(daysAgo) }],
    }, extra || {});
  }

  const orders = [
    order("SO240001", "u_1", [line("p_cup", 0, 2), line("p_candle", 0, 1)], "cvs711", "completed", 18,
      { payment: { methodId: "transfer", methodName: "銀行轉帳（人工對帳）", status: "paid" } }),
    order("SO240002", "u_2", [line("p_tee", 1, 1)], "cvsfami", "shipped", 6,
      { payment: { methodId: "transfer", methodName: "銀行轉帳（人工對帳）", status: "paid" } }),
    order("SO240003", "u_1", [line("p_apron", 0, 1)], "home", "paid", 2,
      { payment: { methodId: "transfer", methodName: "銀行轉帳（人工對帳）", status: "paid" } }),
    order("SO240004", "u_3", [line("p_tote", 1, 1), line("p_tee", 3, 2)], "cvs711", "paid", 1,
      { payment: { methodId: "cod", methodName: "取貨付款", status: "unpaid" } }),
    order("SO240005", "u_4", [line("p_candle", 0, 2)], "cvsfami", "pending_payment", 0),
  ];
  orders[1].shipping.trackingNo = "F12345678901";

  // 行銷：日期用「今天往前／往後幾天」，範例資料永遠在有效期間內
  const ymd = offset => {
    const d = new Date(now + offset * day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const coupons = [
    { id: "cp_welcome", code: "WELCOME100", name: "新客折 100", type: "amount", value: 100, maxDiscount: 0,
      minSpend: 800, startAt: "", endAt: "", usageLimit: 0, perCustomer: 1, membersOnly: false, stackable: true,
      enabled: true, usedCount: 0, createdAt: iso(30) },
    { id: "cp_autumn", code: "AUTUMN85", name: "秋季 85 折", type: "percent", value: 85, maxDiscount: 300,
      minSpend: 1000, startAt: ymd(-10), endAt: ymd(20), usageLimit: 100, perCustomer: 0, membersOnly: false, stackable: false,
      enabled: true, usedCount: 0, createdAt: iso(10) },
    { id: "cp_freeship", code: "FREESHIP", name: "會員免運券", type: "freeship", value: 0, maxDiscount: 0,
      minSpend: 500, startAt: "", endAt: "", usageLimit: 0, perCustomer: 0, membersOnly: true, stackable: true,
      enabled: true, usedCount: 0, createdAt: iso(8) },
    { id: "cp_summer", code: "SUMMER50", name: "夏日折 50（已過期）", type: "amount", value: 50, maxDiscount: 0,
      minSpend: 500, startAt: ymd(-60), endAt: ymd(-5), usageLimit: 0, perCustomer: 0, membersOnly: false, stackable: true,
      enabled: true, usedCount: 0, createdAt: iso(60) },
  ];
  const promotions = [
    { id: "pm_autumn", name: "秋季滿額折", tiers: [{ min: 1500, off: 150 }, { min: 3000, off: 400 }],
      startAt: ymd(-10), endAt: ymd(20), enabled: true, createdAt: iso(10) },
  ];

  return {
    version: 4,
    sessions: {},
    cartCoupon: "",
    currentStoreId: "demo",
    stores: {
      demo: {
        id: "demo",
        settings: {
          name: "晨霧選物",
          tagline: "日常裡好用、耐看的小東西",
          email: "hello@example.com",
          phone: "04-1234-5678",
          freeShippingThreshold: 1200,
          lowStockAlert: 3,
          shippingMethods: [
            { id: "cvs711", name: "7-11 取貨", type: "cvs", fee: 60, enabled: true },
            { id: "cvsfami", name: "全家取貨", type: "cvs", fee: 60, enabled: true },
            { id: "home", name: "宅配到府", type: "home", fee: 100, enabled: true },
          ],
          paymentMethods: [
            { id: "transfer", name: "銀行轉帳（人工對帳）", enabled: true, integrated: false,
              instruction: "下單後請於 3 天內匯款，商家確認後出貨。" },
            { id: "cod", name: "取貨付款", enabled: true, integrated: false,
              instruction: "取貨時付款即可。" },
            { id: "card", name: "信用卡", enabled: false, integrated: false,
              instruction: "尚未串接金流。" },
          ],
        },
        categories: [
          { id: "c_home", name: "生活器物" },
          { id: "c_wear", name: "服飾配件" },
          { id: "c_scent", name: "香氛" },
        ],
        products, customers, orders, coupons, promotions,
        counters: { order: 5 },
      },
    },
    cart: [],
  };
};
