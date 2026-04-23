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

  // 担当マーク
  STAFF_MARKS: {
    '林和人': '〇',
    '横山優': '▽',
    '桃井侑菜': '☆',
    '伊藤佐和子': '◎',
    '奥村亜優李': '□',
    '浅野儀頼': '◇',
  },

  // 当番ローテーション
  DUTY_ROTATION: {
    1: { '分荷撮影': ['林和人','伊藤佐和子','奥村亜優李'], '出品': '奥村亜優李', '取引ナビ': '奥村���優李', '梱包出荷': '桃井侑菜' },
    2: { '分荷撮影': ['林和人','伊藤佐和子','奥村亜優李'], '出品': '横山優', '取引ナビ': '奥村亜優李', '梱包出荷': null },
    3: { '分荷撮影': ['林和人','伊藤佐和子'], '出品': '林和人', '取引ナビ': null, '梱包出荷': '桃井侑菜' },
    4: { '分荷撮影': ['林和人','横山優','奥村亜優��'], '��品': '奥村亜優李', '取引ナビ': '奥村亜優李', '梱包出荷': null },
    5: { '分荷撮影': ['林和人','伊藤佐和子','横山優','奥村亜優李'], '出品': '横山優', '取引ナビ': '奥村亜優李', '梱包出荷': null },
  },

  CLEANING_EXCLUDED: ['浅野儀頼', '三島圭織'],

  APP_VERSION: '2.0.0',
};
