/**
 * テイクバック流通 v2 - 設定
 */
export const CONFIG = {
  // Supabase（新DB: firsteight-group）
  SUPABASE_URL: 'https://peportftucwuxfnmaanr.supabase.co',
  SUPABASE_KEY: 'sb_publishable_ndRcO6c962YBhShB3gP3MA_kHRmaofQ',

  // Supabase AWAI（Edge Function: AI判定・Drive保存）
  AWAI_URL: 'https://njdnfvlucwasrafoepmu.supabase.co',
  AWAI_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qZG5mdmx1Y3dhc3JhZm9lcG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTEzNjgsImV4cCI6MjA5MDg4NzM2OH0.jDjqf3nWqaQ0sMfDf-85dDQNbEhX90qLsOOhWJdDlM8',

  // 販売チャンネル
  CHANNELS: [
    { id: 1, name: 'アイロンポット', platform: 'ヤフオク', category: 'jisha', target: 'ビンテージ単品・まとめ売り', type: 'tsuhan', accepts_matome: true },
    { id: 2, name: 'ブロカント', platform: 'ヤフオク', category: 'jisha', target: '現行品単品・まとめ売り', type: 'tsuhan', accepts_matome: true },
    { id: 3, name: 'eBay', platform: 'eBay', category: 'jisha', target: '単品・まとめ', type: 'tsuhan' },
    { id: 4, name: 'Amazon書籍', platform: 'Amazon', category: 'jisha', target: '書籍', type: 'tsuhan' },
    { id: 10, name: '渡辺質店', platform: 'ヤフオク', category: 'itaku', target: '委託品', type: 'tsuhan' },
    { id: 11, name: 'ビッグスポーツ', platform: 'ヤフオク', category: 'itaku', target: '委託品', type: 'tsuhan' },
    { id: 20, name: 'シマチヨ', platform: 'ヤフオク', category: 'kojin', target: '浅野さん指定品のみ', type: 'tsuhan' },
    { id: 90, name: '社内利用', platform: null, category: null, target: null, type: 'non-tsuhan' },
    { id: 91, name: 'ロット販売', platform: null, category: null, target: null, type: 'non-tsuhan' },
    { id: 92, name: 'スクラップ', platform: null, category: null, target: null, type: 'non-tsuhan' },
    { id: 93, name: '廃棄', platform: null, category: null, target: null, type: 'non-tsuhan' },
  ],

  // ステータス定義（工程順）
  STATUS: {
    // 入荷フロー
    RECEIVED: '受取済み',
    JUDGED: '分荷確定',
    PHOTO_WAIT: '撮影待ち',
    // 販売フロー
    LIST_WAIT: '出品待ち',
    LISTING_WORK: '出品作業中',
    LISTING: '出品中',
    // 取引フロー
    SOLD: '落札済み',
    CONTACT_WAIT: '連絡待ち',
    SHIPPING_NOTIFIED: '送料連絡済み',
    PAYMENT_WAIT: '入金待ち',
    PAYMENT_CONFIRMED: '入金確認済み',
    PACK_WAIT: '梱包待ち',
    PACKING: '梱包中',
    PACK_DONE: '梱包完了',
    SHIPPED: '発送済み',
    RECEIVED_CONFIRM: '受取確認',
    COMPLETE: '完了',
    // 相談
    CONSULT: '確認/相談',
    // 委託返却
    RETURN_PENDING: '返却予定',
    // 特別（トラブル��
    ISSUE_REPORTED: '商品問題連絡',
    CARRIER_CONSULT: '運送会社相談中',
    COLLECTING: '商品回収中',
    RETURNING: '返送中',
    INSPECTING: '商品確認中',
    CANCEL_PROCESS: 'キャンセル処理',
    REFUND_PROCESS: '返金処理',
    CARRIER_CLAIM: '運送会社請求中',
    CARRIER_PAID: '運送会社入金確認',
    CANCELLED: 'キャンセル',
  },

  // 通常フローのステータス順序
  STATUS_FLOW: [
    '受取済み', '分荷確定', '撮影待ち', '出品待ち',
    '出品作業中', '出品中', '落札済み', '連絡待ち',
    '送料連絡済み', '入金待ち', '入金確認済み',
    '梱包待ち', '梱包中', '梱包完了', '発送済み',
    '受取確認', '完了',
  ],

  // ステータスをモジュールにマッピング
  STATUS_MODULE: {
    '受取済み': 'intake', '分荷確定': 'intake', '撮影待ち': 'intake',
    '出品待ち': 'sales', '出品作業中': 'sales', '出品中': 'sales',
    '落札済み': 'trade', '連絡待ち': 'trade', '送料連絡済み': 'trade',
    '入金待ち': 'trade', '入金確認済み': 'trade',
    '梱包待ち': 'trade', '梱包中': 'trade', '梱包完了': 'trade',
    '発送済み': 'trade', '受取確認': 'trade', '完了': 'trade',
    '確認/相談': 'intake',
    '返却予定': 'trade',
  },

  // コスト基準（Slack Bot prompts.pyより）
  COSTS: {
    warehouse_monthly: 195000,
    payroll_monthly: 420000,
    operating_monthly: 85000,
    profit_target_monthly: 800000,
    hourly_rate: 1600,
    size_work_cost: { small: 2000, medium: 3000, large: 4500, xlarge: 6000 },
    size_storage_monthly: { small: 300, medium: 800, large: 2000, xlarge: 4000 },
    size_shipping: { 60: 800, 80: 1100, 100: 1400, 140: 2100, 160: 2600, 170: 3200, 200: 5000, 220: 8000 },
    min_listing_price: { 80: 2200, 140: 4500, 200: 7500, 999: 12000 },
  },

  // 佐川急便 通常運賃（税込、東海発）※出品ページに表示する定価
  SAGAWA_PUBLIC_RATES: {
    sizes: [60, 80, 100, 140, 160, 170, 180, 200, 220, 240, 260],
    regions: ['北海道','北東北','南東北','関東','信越','東海','北陸','関西','中国','四国','北九州','南九州'],
    rates: {
      60:  [1570, 1180, 1040, 910, 910, 910, 910, 910, 1040, 1180, 1180, 1180],
      80:  [1840, 1470, 1340, 1220, 1220, 1220, 1220, 1220, 1340, 1470, 1470, 1470],
      100: [2130, 1740, 1630, 1520, 1520, 1520, 1520, 1520, 1630, 1740, 1740, 1740],
      140: [2830, 2440, 2310, 2180, 2180, 2180, 2180, 2180, 2310, 2440, 2440, 2440],
      160: [3090, 2700, 2570, 2440, 2440, 2440, 2440, 2440, 2570, 2700, 2700, 2700],
      170: [4770, 3770, 3420, 3360, 2890, 2600, 2770, 2770, 3130, 3130, 3360, 3710],
      180: [5360, 4130, 3770, 3660, 3130, 2890, 2950, 2950, 3420, 3420, 3660, 4130],
      200: [6720, 5130, 4600, 4480, 3720, 3480, 3480, 3480, 4130, 4130, 4420, 5070],
      220: [8070, 6070, 5420, 5240, 4360, 4070, 4070, 4070, 4840, 4840, 5240, 5950],
      240: [10780, 7950, 7070, 6830, 5540, 5240, 5240, 5240, 6240, 6240, 6770, 7830],
      260: [13480, 9830, 8710, 8420, 6770, 6420, 6420, 6420, 7660, 7660, 8360, 9720],
    },
  },

  // 佐川急便 契約運賃表（税別、東海発、2024/04/01〜2025/03/31）※社内用・実コスト
  SAGAWA_RATES: {
    sizes: [60, 80, 100, 140, 160, 170, 180, 200, 220, 240, 260],
    regions: ['北海道','北東北','南東北','関東','信越','東海','北陸','関西','中国','四国','北九州','南九州'],
    rates: {
      60:  [600, 590, 570, 570, 570, 550, 550, 540, 570, 570, 570, 580],
      80:  [710, 680, 640, 620, 620, 600, 600, 590, 610, 620, 630, 660],
      100: [870, 810, 740, 690, 710, 640, 650, 620, 680, 690, 730, 770],
      140: [1620, 1410, 1240, 1090, 1130, 970, 990, 880, 1060, 1080, 1190, 1340],
      160: [2200, 1900, 1620, 1410, 1470, 1230, 1270, 1100, 1370, 1400, 1570, 1780],
      170: [3390, 2880, 2420, 2060, 2160, 1750, 1820, 1560, 2000, 2050, 2330, 2670],
      180: [4100, 3490, 2940, 2510, 2620, 2140, 2230, 1910, 2420, 2490, 2820, 3230],
      200: [5330, 4510, 3790, 3220, 3360, 2720, 2830, 2400, 3100, 3180, 3630, 4170],
      220: [6540, 5510, 4610, 3900, 4090, 3280, 3410, 2890, 3760, 3850, 4430, 5110],
      240: [9000, 7220, 6150, 5310, 5570, 4450, 4620, 3890, 5030, 5250, 6030, 6990],
      260: [11490, 8930, 7600, 6730, 6960, 5610, 5830, 4910, 6150, 6650, 7660, 8830],
    },
  },

  // 出品説明文テンプレート（定型部分）
  LISTING_TEMPLATES: {
    // 【状態・注意事項】定型文
    conditionNotes: `【状態・注意事項】
・詳しい事が分からないため、質問を頂いてもお答えできない場合がございます。
・見落とし、個々の感じ方の違いによる行き違い、取り切れない汚れや初期からの傷汚れがある場合がございます。
・現状品です。画像をご覧の上ご判断くださいますようお願い致します。
・一度人の手に渡ったものですので完全な状態は保証できません。`,

    // 【発送方法】佐川急便（小型〜中型）
    shippingSagawa: (size) => `【発送方法】
・発送は岐阜県からの、宅配便にての発送になります。
（サイズや配送業者に関しては当社規定により選定させて頂いております）

＝送料＝（令和6年2月2日より送料を改訂致しました。）
〈北海道〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[0] || '---'}円
〈青森・秋田・岩手〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[1] || '---'}円
〈宮城・山形・福島〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[2] || '---'}円
〈茨城・栃木・群馬・埼玉・千葉・東京・神奈川・山梨〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[3] || '---'}円
〈長野・新潟〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[4] || '---'}円
〈静岡・愛知・岐阜・三重〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[5] || '---'}円
〈富山・石川・福井〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[6] || '---'}円
〈京都・滋賀・奈良・和歌山・大阪・兵庫〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[7] || '---'}円
〈岡山・広島・山口・鳥取・島根〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[8] || '---'}円
〈香川・徳島・高知・愛媛〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[9] || '---'}円
〈福岡・佐賀・長崎・大分〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[10] || '---'}円
〈熊本・宮崎・鹿児島〉 ${CONFIG.SAGAWA_PUBLIC_RATES.rates[size]?.[11] || '---'}円
※沖縄、離島は高額になりますのでご入札前にご質問下さい。
・梱包資材として、段ボール・エアキャップ・新聞紙・紙袋など簡易包装を行っております。
・急ぎの発送や発送方法の変更には応じかねます。
・基本的には土日祝日の発送には対応いたしておりません。
・直接引取にもご対応致します。落札後、取引ナビにて "直接引取希望" とご連絡をお願い致します。`,

    // 【発送方法】アートセッティング（大型家財）
    shippingArt: (rank, count) => `【発送方法】
アートセッティングデリバリー家財おまかせ便
・発送は岐阜県からの発送になります。
（お願い：サイズに関しては当社規定により選定させて頂いておりますことを予めご理解下さい。）

・こちらの商品は大きな商品になりますので、アートセッティングデリバリー家財おまかせ便での発送になります。
一部地域はご配送できない地域がございますのでご注意ください。

・商品が大きい為、送料は高額になります。ご理解の程宜しくお願い致します。

家財おまかせ便発送ランク：${rank}ランク${count}個口

・送料についてはお客様でお調べいただけると助かります。
・落札者様のお電話番号が必要になります。落札後に取引メッセージにてお電話番号のご連絡をお願い致します。

・申し訳ありませんが、急ぎの発送や発送方法の変更には応じかねますのでお願い致します。
・基本的には土日祝日の発送には対応いたしておりません。
・直接引取をご希望の場合は落札後、取引ナビにて直接引取希望とご連絡をお願い致します。
・引き渡し場所は 岐阜市上川手(名鉄茶所駅近く)です。平日10時から16時までのご対応させて頂いております。`,

    // 【取引詳細・その他】定型文
    tradingNotes: `【取引詳細・その他】
・平日16:00以降および土日祝はご質問回答・送料連絡等が出来ませんのでご連絡が遅くなります。ご了承ください。
・商品説明に記載した情報の中には出品者の見え方で記載している情報がございますので、個々の感じ方の違いによる行き違いが発生する場合がございます。あくまで個人的な主観とお考え下さい。
・ご入札をお考えの方で疑問点がある方は、入札前に質問欄よりご連絡下さい。
・撮影から日数を経ることにより必ず同じ状態とは限りません。
・商品を理解の上、落札してください。お願いします。
・写真に写っているものが全てとなります。
・お約束のノークレームノーリターンでお願いします。
・商品に関して過度に神経質な方のご入札はお控えください。
・写真の写り具合、モニタの設定などにより、実際の色味と違う場合があります。ご了承下さい`,
  },

  // 状態ランク
  CONDITIONS: {
    S: '新品・未使用（タグ/箱あり）',
    A: '未使用に近い（使用感ほぼなし）',
    B: '中古美品（使用感あり・目立つ傷なし）',
    C: '中古（使用感・傷・汚れあり）',
    D: 'ジャンク（動作不良・部品取り）',
  },

  // 運送会社
  CARRIERS: [
    { id: 1, name: '佐川急便' },
    { id: 2, name: 'アートデリバリー' },
    { id: 3, name: '西濃運輸' },
    { id: 4, name: 'ヤマト運輸' },
    { id: 5, name: '日本郵便' },
    { id: 6, name: '直接引き取り' },
    { id: 7, name: '後日発送' },
  ],

  // 倉庫コード
  WAREHOUSES: {
    A: '厚見倉庫',
    H: '本荘倉庫',
    Y: '柳津倉庫',
  },

  // E飛伝CSV依頼主
  SENDER: {
    zip: '5008833',
    addr1: '岐阜県岐阜市神田町',
    addr2: '',
    name1: '株式会社テイクバック',
    tel: '058-000-0000', // TODO: よしさんに確認
  },

  // チームKPI目標（1日あた���）
  DAILY_KPI: {
    bunka: 58,
    shuppin: 53,
    konpo: 16,
  },

  // 浅野承認が必要な条件
  APPROVAL_RULES: {
    high_value_threshold: 30000,
    conditions: [
      '¥30,000以上',
      '希少品・レア品',
      '骨董品・アンティーク',
      '貴金属・宝石',
      '含み益が大きい',
      '社���利用',
      'AI不確信（confidence < 0.7）',
    ],
  },

  // 委託販売設定
  CONSIGNMENT: {
    'ビッグスポーツ': { rate: 50, fixed: true },
    '渡辺質店': { rate: null, fixed: false },
    'シマチヨ': { rate: null, fixed: false },
  },

  // 返却理由
  RETURN_REASONS: [
    { id: 'unsold', label: '売れ残り' },
    { id: 'fake', label: '偽物・返品' },
    { id: 'cant_list', label: '出品不可' },
    { id: 'partner_request', label: '委託元依頼' },
  ],

  // 動作確認ステータス
  OPERATION_STATUS: [
    { id: 'verified', label: '動作確認済み（正常）', icon: '✅', titleTag: '【動作確認済】' },
    { id: 'power_only', label: '通電確認のみ', icon: '⚡', titleTag: '【通電確認済】' },
    { id: 'unchecked', label: '動作未確認', icon: '❓', titleTag: '【動作未確認】' },
    { id: 'defective', label: '動作不良あり', icon: '❌', titleTag: '【ジャンク】' },
  ],

  // 担当マーク
  STAFF_MARKS: {
    '林和人': '〇',
    '横山優': '▽',
    '桃井侑菜': '☆',
    '伊藤佐和子': '◎',
    '奥村亜優李': '□',
    '浅野儀頼': '◇',
  },

  // 固定担当（担当制廃止。以下のみ固定）
  DUTY_FIXED: {
    '梱包・出荷': '桃井侑菜',
    '書籍販売': '桃井侑菜',
    '取引ナビ': '奥村亜優李',
  },
  // 掃除当番ローテーション対象者
  CLEANING_ROTATION: ['林和人', '横山優', '伊藤佐和子', '奥村亜優李', '桃井侑菜', '平野光雄', '松本豊彦', '北瀬孝'],

  CLEANING_EXCLUDED: ['浅野儀頼', '三島圭織'],

  // スタッフ基本情報（勤務時間・休日）
  // offDays: 0=日,1=月,2=火,3=水,4=木,5=金,6=土
  STAFF: [
    { name: '浅野儀頼', role: 'admin', start: '09:00', end: '18:00', breakMin: 60, offDays: [], showTimeline: false },
    { name: '林和人', role: 'staff', start: '09:00', end: '16:00', breakMin: 60, offDays: [] },
    { name: '横山優', role: 'staff', start: '10:00', end: '16:00', breakMin: 60, offDays: [3] },
    { name: '桃井侑菜', role: 'staff', start: '11:00', end: '15:00', breakMin: 0, offDays: [2,4] },
    { name: '伊藤佐和子', role: 'staff', start: '09:00', end: '15:00', breakMin: 60, offDays: [4] },
    { name: '奥村亜優李', role: 'staff', start: '10:00', end: '16:00', breakMin: 60, offDays: [3] },
  ],

  APP_VERSION: '2.0.0',
};
