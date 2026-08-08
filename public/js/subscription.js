/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 * 
 * 订阅管理前端逻辑
 */

// ==================== 全局状态 ====================
let currentLang = 'zh';
let subConfig = null;
let subStatus = null;
let subHistory = [];
let historyPage = 1;
const pageSize = 5;
let selectedPaymentMethod = null;

// ==================== 货币格式化（中文¥/英文$，汇率从后端获取） ====================
const DEFAULT_USD_RATE = 0.1475; // 后端获取失败时的兜底汇率

function getUsdRate() {
  return (subConfig && subConfig.usdRate) || DEFAULT_USD_RATE;
}

function formatAmount(amountYuan) {
  if (currentLang === 'en') {
    return `$${(amountYuan * getUsdRate()).toFixed(2)}`;
  }
  return `¥${amountYuan.toFixed(2)}`;
}

function formatUnitPrice(priceYuan) {
  if (currentLang === 'en') {
    return `$${(priceYuan * getUsdRate()).toFixed(2)}`;
  }
  return `¥${priceYuan.toFixed(2)}`;
}

function formatPricingDesc(state) {
  if (currentLang === 'en') {
    if (state.mode === 'first') {
      return `First-time authorization fee, includes 2 months, additional at ${formatUnitPrice(3)}/month`;
    }
    if (state.mode === 'reauth') {
      return `Re-authorization required (lapsed >12 months), includes 2 months, additional at ${formatUnitPrice(3)}/month`;
    }
    return `Renewal at ${formatUnitPrice(3)}/month`;
  }
  return state.description || '';
}

// ==================== 收款账号配置（部署时替换为真实信息） ====================
const paymentAccounts = {
  wechat: {
    type: 'qr',
    qrPlaceholder: false,
    qrImageUrl: '/images/wechat_qr.jpg',
    demoImageUrl: '/images/payment_demo.jpg',
    accountLines: ['微信商户号：待配置', '微信商户名称：济宁米多信息科技有限公司']
  },
  alipay: {
    type: 'qr',
    qrPlaceholder: false,
    qrImageUrl: '/images/alipay_qr.jpg',
    demoImageUrl: '/images/alipay_demo.jpg',
    accountLines: ['支付宝账号：待配置', '支付宝商户名称：济宁米多信息科技有限公司']
  },
  paypal: {
    type: 'text',
    demoImageUrl: '/images/paypal_demo.jpg',
    accountLines: ['https://www.paypal.com/ncp/payment/4J9E9KBWEYB3E']
  },
  crypto: {
    type: 'text',
    accountLines: ['USDT-TRC20：待配置', 'BTC：待配置']
  },
  bank: {
    type: 'text',
    accountLines: [
      '开户行：济宁银行股份有限公司解放路支行',
      '对公账户：815012701421003779',
      '公司名称：济宁米多信息科技有限公司',
      '行号：313461002251',
      '打款备注：技术服务费'
    ]
  }
};

// ==================== 中英文文案 ====================
const i18n = {
  zh: {
    pageTitle: '订阅管理',
    companyLine: '济宁米多信息科技有限公司 版权所有',
    statusLabel: '订阅状态',
    active: '已订阅',
    expired: '已过期',
    nosub: '未订阅',
    sdWorldLabel: '世界ID', sdStartLabel: '开始时间', sdExpireLabel: '到期时间',
    sdSysVerLabel: '系统版本', sdAuthVerLabel: '授权版本', sdVerStatusLabel: '版本状态',
    verCurrent: '当前版本', verNeedUpgrade: '需重新购买',
    verOk: '已授权',
    remaining: '剩余 {days} 天',
    overdue: '超期 {days} 天',
    expiresAt: '到期时间：{date}',
    btnFee: '费用说明',
    btnHistory: '支付记录',
    btnRenew: '续费',
    feeTitle: '费用说明',
    feeKey1: '收费标准', feeVal1: '¥3.00 / 月',
    feeKey2: '系统部署日期', feeKey3: '收费单位', feeKey4: '续费规则',
    feeVal4: '从原到期时间往后延',
    pmCnTitle: '中文支付方式（扫码支付）',
    pmWechat: '微信支付（扫码）',
    pmAlipay: '支付宝支付（扫码）',
    pmEnTitle: '英文支付方式',
    pmPaypal: 'PayPal（贝宝账户收款）',
    pmCrypto: '虚拟货币',
    buyTitle: '购买订阅',
    buyMonthsLabel: '购买月数', buyMonthsUnit: '个月',
    buyAmountLabel: '应付金额',
    buyMethodLabel: '支付方式',
    proofLabel: '上传支付凭证截图（需包含交易单号，参照微信支付详情页样式）',
    chooseFile: '选择文件',
    noFileChosen: '未选择任何文件',
    notePlaceholder: '备注：其他补充信息（选填）',
    txnNoLabel: '✅ 交易单号（必填）',
    txnNoPlaceholder: '请输入微信/支付宝交易单号',
    orderNoLabel: '经营单号（选填）',
    orderNoPlaceholder: '其他单号',
    btnSubmit: '确认支付',
    historyTitle: '支付记录',
    qrTitleWechat: '微信支付二维码',
    qrTitleAlipay: '支付宝支付二维码',
    qrTitlePaypal: 'PayPal支付链接',
    qrTitleCrypto: '虚拟货币支付地址',
    qrTitleBank: '对公账户支付',
    qrHintWechat: '请使用微信扫描二维码支付',
    qrHintAlipay: '请使用支付宝扫描二维码支付',
    qrHintPaypal: '请点击PayPal链接完成支付',
    paypalPaymentLink: 'PayPal付款链接',
    qrHintCrypto: '请向以下地址发送虚拟货币',
    qrHintBank: '请向以下对公账户转账',
    qrClose: '关闭',
    methodWechat: '微信支付',
    methodAlipay: '支付宝',
    methodPaypal: 'PayPal',
    methodCrypto: '虚拟货币',
    methodBank: '对公账户',
    methodFreeTrial: '系统赠送',
    successMsg: '续费成功！已延长 {months} 个月',
    successTitle: '支付已提交',
    successBody: '您的支付凭证已成功提交，我们将在核实后为您延长订阅期限。',
    successConfirm: '确定',
    errorMsg: '购买失败：{error}',
    months: '续费 {months} 个月',
    hiExpires: '到期：{date}',
    hiProof: '查看凭证',
    hiNoProof: '无凭证',
    historyModalTitle: '支付记录',
    historyEmpty: '暂无支付记录',
    historyPrev: '上一页',
    historyNext: '下一页',
    historyClose: '关闭',
    historyPage: '第 {page}/{total} 页',
    hiTxnNo: '交易单号',
    hiOrderNo: '经营单号',
    hiNote: '备注',
    hiNoNote: '无备注',
    hiWorldId: '世界ID',
    hiWorldUrl: '世界地址',
    btnExport: '导出CSV',
    exportFileName: '支付记录',
    proofRequired: '请上传支付凭证截图',
    companyInfoTitle: '许可费用与支付约定',
    licenseTerm1: '甲乙双方确认：本协议约定软件许可费用（人民币 3 元 / 60 元），为甲方应付的许可对价。甲方通过境内支付渠道（微信支付、支付宝、银行转账等）完成支付的，交易中产生的正常平台手续费（如支付通道按比例收取的手续费）由乙方承担，甲方无需额外补差。甲方按页面显示金额支付即可，视为已全额履行付款义务。',
    licenseTerm2: '发票配套说明：如甲方需要乙方开具正规发票，因开票涉及人工处理、账务归档、财税系统运维等配套成本，甲方须另行承担该部分费用。甲方应当在发起付款前主动告知开票需求，并同步支付前述配套成本；未预先支付的，乙方有权暂缓开具发票。',
    licenseTerm3: '跨境付款特别约定：甲方选择境外汇款方式支付许可费时，国际汇款普遍存在不可预估的中间行扣费，可能出现扣费后乙方实际到账金额严重不足的情况。甲方应当选择汇款方承担全部手续费（OUR）模式发起转账，确保跨境流转产生的扣款损失由甲方承担；若因中间行扣费导致乙方实际到账不足约定金额，甲方需补齐差额。',
    licenseTerm4: '甲方确认：付款即视为同意本协议。境内支付的正常平台手续费由乙方自行承担，不影响甲方付款义务的履行；跨境汇款时甲方应选择 OUR 模式确保足额到账。本协议不存在重大误解、欺诈情形。',
    feeVal3: '济宁米多信息科技有限公司',
    deployDate: '系统首次部署运行日期',
    renewRule: '从原到期时间往后延，已过期则从今天开始',
    qrPlaceholder: '请在实际使用时替换为真实二维码图片',
    prefaceTitle: '✨ 作者前言',
    preface1: '这个产品我考虑使用授权来和喜欢的朋友一起把它做下去。如果你也喜欢欢迎订阅我，并连接我。我想持续的完善它并创造更多的未来，但是囊中羞涩还要生活。如果这个授权对你的生活产生负担，请不要继续授权。程序你可以一直用。如果你把世界通过 IP/域名开放给他人访问，或与其他世界建立联邦连接，说明它已经在发挥联网价值，希望你订阅授权支持持续开发；若进行二次开发并对外销售，请与我联系获得授权并回馈作者。',
    preface2: '费是首次先交纳60元，以后每月3元，你没看错续费3元/月，一年36元，十年360元，一百年3600元。',
    preface3: '我将会持续更新本系统，如果喜欢的人多订阅多，我将会快速的更新。我的首批用户是我最大的动力。即使喜欢的人少我也会持续更新我将要用一生完善这个软件，完善我喜欢的东西。当然了你如果和我有相同的想法可以联系我，但是我没有钱雇佣和给您费用。',
    preface4: '这个代码只是基础轮廓，至于能雕刻成什么样就看各位的创造力了。',
    preface5: '我想通过按月授权付费获取用户支持，支持我持续开发本项目。我不想接受投资人这样会非常商业化，急功近利不是我们这个虚拟世界所需要的。用户的支持够日常开销即可。多了我会加快进度，少了我就慢点。一边生活一边筑梦吧！',
    preface6: '如果不想订阅并且您不在乎钱，请联系我探讨合作方式。',
    preface7: '致敬筑梦人！软件未做加密，希望它能帮助铸造你的梦。如果联网用请记得作者生活还很窘迫。',
    prefaceDonateTitle: '自愿赞助',
    prefaceDonateText: '如认可我们的项目、想额外助力项目筑梦，可通过多买授权时间来更多地支持我们。每一份善意我都悉数珍藏、万分感谢，所有支持将全部用于项目研发与持续迭代。',
    prefaceDonateNotice: '授权仅对当前购买版本有效。版本升级后（系统发布新版本）需重新购买授权（3元/月），原授权时间仍可继续使用旧版本。',
    prefaceFooterLine1: '订阅用户可获得当前版本授权期间的软件更新。版本升级后需重新购买授权。',
    prefaceFooterLine2: '基于本程序的二开依然需要订阅我们，支持作者优化程序，希望谅解抱歉！',
    demoTitle: '📷 截图演示参考',
    demoDesc: '支付凭证截图请参照微信支付详情页样式，需清晰显示：',
    demoItem1: '✅ 交易单号（必填）',
    demoItem2: '经营单号（选填）',
    demoItem3: '✅ 支付金额',
    demoItem4: '✅ 收款方：米多科技',
    demoItem5: '✅ 支付时间',
    termsTitle: '订阅服务条款',
    termsSubtitle: '请仔细阅读以下条款，同意后方可继续支付',
    termsSection1Title: '一、服务说明',
    termsSection1: '本订阅服务由<span class="terms-highlight">济宁米多信息科技有限公司</span>提供，用户通过上传支付凭证截图的方式完成订阅续费。系统将在收到凭证后自动为您延长订阅期限。',
    termsSection2Title: '二、简版订阅费用说明',
    termsSection2: '首次订阅<span class="terms-highlight">60元</span>（美元<span class="terms-highlight">9.18美元</span>），赠送2个月。<br><br>一个世界：续费<span class="terms-highlight">3元/月</span>，一年36元，十年360元，一百年3600元。<span class="terms-warning">授权仅对当前购买版本有效</span>。版本升级后（系统发布新版本）需重新购买授权（3元/月），原授权时间仍可继续使用旧版本。<br><br>中间订阅断了需要再次缴纳最高为<span class="terms-warning">60元</span>，超过12个月未订阅需重新缴纳60元。<br><br>中断订阅超过12个月以上的，直接缴纳最高60元即可获取最新系统。<br><br><span style="color:var(--muted);font-size:12px">（本条款旨在支持我们持续开发优化本系统，需要的是长久的持续支持。）</span>',
    termsSection3Title: '三、退款政策',
    termsSection3: '由于本系统采用凭证确认机制，<span class="terms-warning">一旦确认支付并提交凭证，将不予退款</span>。请在提交前仔细核对支付金额和凭证信息。',
    termsSection4Title: '四、服务变更',
    termsSection4: '我们保留根据项目发展调整订阅价格和服务的权利，但已购买期间的权益不受影响。价格调整将提前公告。',
    termsSection5Title: '五、免责声明与资产归属',
    termsSection5: '本软件按"现状"提供，不提供任何明示或暗示的担保。我方仅交付软件程序使用授权，但不对因不可抗力、系统维护、软件BUG、设计缺陷、服务器、二次开发等问题造成的任何损失承担责任。<br><br>世界内的任何虚拟资产（包括但不限于图片、模型、视频、特效、场景、美术作品等）均属于<span class="terms-highlight">世界所有者</span>。世界所有者对世界内全部资产承担<span class="terms-warning">全部法律责任</span>。济宁米多信息科技有限公司对世界内全部资产及附属产品<span class="terms-warning">无任何归属及法律权利</span>。',
    termsSection6Title: '六、知识产权',
    termsSection6: '本系统所有代码、设计、商标、专利均归济宁米多信息科技有限公司所有。订阅用户获得软件授权，<span class="terms-highlight">可商业使用</span>，但<span class="terms-warning">严禁二次销售和仿制</span>。违规使用将承担法律责任。',
    termsSection7Title: '七、法律适用',
    termsSection7: '本条款适用中华人民共和国法律。因本条款产生的争议，双方应友好协商解决；协商不成的，提交济宁仲裁委员会仲裁。',
    termsSection8Title: '八、货币收款说明',
    termsSection8: '只要能打款过来且有支付记录我们能查到即可。其他货币定价以人民币为最小值（3元/月）进行换算。<br><br>以<span class="terms-highlight">美元</span>为例：按今日实时市场汇率 1人民币≈0.1475美元计算，3×0.1475＝<span class="terms-highlight">0.4425美元</span>，打款<span class="terms-highlight">0.443美元以上</span>即可。尽量多些吧！虽然费用不多。',
    termsCheckLabel: '我已仔细阅读并同意以上全部条款',
    btnTermsAgree: '同意并继续支付',
    btnTermsCancel: '取消',
    termsMustAgree: '请先阅读并同意订阅服务条款',
    notLoggedIn: '未登录管理员账号',
    requestFailed: '请求失败',
    totalRecords: '共 {count} 条记录',
    exportSuccess: '导出成功！共 {count} 条记录',
    selectPaymentFirst: '请先点击选择一个支付方式',
    selectPaymentToast: '请先选择支付方式',
    uploadProof: '请上传支付凭证截图',
    fillTxnNo: '请填写微信/支付宝交易单号',
    fillTxnNoToast: '请填写交易单号',
    submitting: '提交中...',
    qrDemoLabel: '截图演示参考',
    qrDemoPlaceholderText: '请将支付详情截图保存为<br>/images/payment_demo.jpg',
    qrDemoItem1: '✅ 交易单号（必填）',
    qrDemoItem2: '✅ 经营单号（必填）',
    qrDemoItem3: '✅ 支付金额',
    qrDemoItem4: '✅ 收款方：米多科技',
    qrDemoItem5: '✅ 支付时间',
    amountHint: ''
  },
  en: {
    pageTitle: 'Subscription Management',
    companyLine: '© Jinan Miduo Information Technology Co., Ltd.',
    statusLabel: 'Subscription Status',
    active: 'Active',
    expired: 'Expired',
    nosub: 'Not Subscribed',
    sdWorldLabel: 'World ID', sdStartLabel: 'Start', sdExpireLabel: 'Expires',
    sdSysVerLabel: 'System Ver', sdAuthVerLabel: 'Auth Ver', sdVerStatusLabel: 'Ver Status',
    verCurrent: 'Current', verNeedUpgrade: 'Upgrade Needed',
    verOk: 'Authorized',
    remaining: 'Remaining: {days} days',
    overdue: 'Overdue: {days} days',
    expiresAt: 'Expires: {date}',
    btnFee: 'Fee Info',
    btnHistory: 'Payment History',
    btnRenew: 'Renew',
    feeTitle: 'Fee Information',
    feeKey1: 'Rate', feeVal1: '$0.44 / Month',
    feeKey2: 'System Deploy Date', feeKey3: 'Billing Company', feeKey4: 'Renewal Rule',
    feeVal4: 'Extended from original expiry date',
    pmCnTitle: 'Chinese Payment Methods (QR Scan)',
    pmWechat: 'WeChat Pay (QR Scan)',
    pmAlipay: 'Alipay (QR Scan)',
    pmEnTitle: 'English Payment Methods',
    pmPaypal: 'PayPal (Account Payment)',
    pmCrypto: 'Cryptocurrency',
    buyTitle: 'Purchase Subscription',
    buyMonthsLabel: 'Months', buyMonthsUnit: ' months',
    buyAmountLabel: 'Amount',
    buyMethodLabel: 'Payment Method',
    proofLabel: 'Upload Payment Proof (Must include Transaction No., see WeChat Pay detail screenshot)',
    chooseFile: 'Choose File',
    noFileChosen: 'No file chosen',
    notePlaceholder: 'Note: Other supplementary information (optional)',
    txnNoLabel: '✅ Transaction No. (required)',
    txnNoPlaceholder: 'Enter WeChat/Alipay transaction number',
    orderNoLabel: 'Merchant No. (optional)',
    orderNoPlaceholder: 'Other reference number',
    btnSubmit: 'Confirm Payment',
    historyTitle: 'Payment History',
    qrTitleWechat: 'WeChat Pay QR Code',
    qrTitleAlipay: 'Alipay QR Code',
    qrTitlePaypal: 'PayPal Payment Link',
    qrTitleCrypto: 'Cryptocurrency Address',
    qrTitleBank: 'Corporate Bank Transfer',
    qrHintWechat: 'Scan QR code with WeChat to pay',
    qrHintAlipay: 'Scan QR code with Alipay to pay',
    qrHintPaypal: 'Click PayPal link to complete payment',
    paypalPaymentLink: 'PayPal Payment Link',
    qrHintCrypto: 'Send cryptocurrency to the address below',
    qrHintBank: 'Transfer to the corporate bank account below',
    qrClose: 'Close',
    methodWechat: 'WeChat Pay',
    methodAlipay: 'Alipay',
    methodPaypal: 'PayPal',
    methodCrypto: 'Cryptocurrency',
    methodBank: 'Bank Transfer',
    methodFreeTrial: 'Free Trial',
    successMsg: 'Renewed successfully! Extended by {months} months',
    successTitle: 'Payment Submitted',
    successBody: 'Your payment proof has been submitted. We will extend your subscription after verification.',
    successConfirm: 'OK',
    errorMsg: 'Payment failed: {error}',
    months: '{months} months',
    hiExpires: 'Expires: {date}',
    hiProof: 'View Proof',
    hiNoProof: 'No Proof',
    historyModalTitle: 'Payment History',
    historyEmpty: 'No payment records',
    historyPrev: 'Prev',
    historyNext: 'Next',
    historyClose: 'Close',
    historyPage: 'Page {page}/{total}',
    hiTxnNo: 'Transaction No.',
    hiOrderNo: 'Merchant No.',
    hiNote: 'Note',
    hiNoNote: 'No note',
    hiWorldId: 'World ID',
    hiWorldUrl: 'World URL',
    btnExport: 'Export CSV',
    exportFileName: 'Payment_History',
    proofRequired: 'Please upload payment proof screenshot',
    companyInfoTitle: 'License Fees & Payment Terms',
    licenseTerm1: 'Both parties confirm that the software license fee agreed upon in this Agreement (RMB 3 / 60) is the consideration payable by Party A. When Party A completes payment through domestic payment channels (WeChat Pay, Alipay, bank transfer, etc.), normal platform handling fees (such as proportional payment channel fees) shall be borne by Party B, and Party A is not required to make up any difference. Party A may pay the amount displayed on the page, which shall be deemed full performance of its payment obligation.',
    licenseTerm2: 'Invoice Support: If Party A requires Party B to issue an official invoice, Party A shall separately bear the supporting costs associated with invoicing, including manual processing, accounting archiving, and tax/financial system maintenance. Party A shall proactively inform Party B of the invoicing requirement before initiating payment and simultaneously pay such supporting costs; if Party A fails to pay in advance, Party B has the right to defer issuing the invoice.',
    licenseTerm3: 'Special Provision for Cross-Border Payments: When Party A chooses to pay by overseas remittance, international wire transfers commonly involve unpredictable intermediary bank fees that may result in Party B receiving significantly less than the agreed amount. Party A shall initiate the transfer using the OUR (Remitter Pays All Charges) mode to ensure that deduction losses from cross-border transfers are borne by Party A; if intermediary bank deductions cause the actual amount received by Party B to fall short of the agreed amount, Party A shall make up the difference.',
    licenseTerm4: 'Party A confirms that payment constitutes agreement to this Agreement. Normal platform handling fees for domestic payments shall be borne by Party B and shall not affect Party A\'s performance of its payment obligation; for cross-border remittances, Party A shall select OUR mode to ensure full amount arrival. This Agreement involves no material misunderstanding or fraud.',
    feeVal3: 'Jinan Miduo Information Technology Co., Ltd.',
    deployDate: 'First deployment date',
    renewRule: 'Extended from original expiry; if expired, starts from today',
    qrPlaceholder: 'Replace with real QR code image in production',
    prefaceTitle: '✨ Author\'s Preface',
    preface1: 'Author\'s Preface: I am considering licensing this product so that friends who love it can help carry it forward. If you love it too, welcome to subscribe and connect with me. I want to keep improving it and creating more futures, but my pockets are empty and life demands its toll. If this license causes financial hardship, please do not continue. You may use the program freely. If you open your world to others via IP/domain, or establish federation connections with other worlds, it is already delivering networked value; I hope you will subscribe to support continued development. If you carry out secondary development and sell it externally, please contact me for authorization and give back to the author.',
    preface2: 'The fee is $8.85 for the first payment, then $0.44 per month. Yes, you read that right — renewal is $0.44/month, $5.31/year, $53.10/decade, $531.00/century.',
    preface3: 'I will continuously update this system. More subscribers means faster updates. My earliest users are my greatest motivation. Even with few fans, I will keep updating — I will spend my lifetime perfecting this software, perfecting what I love. If you share the same vision, contact me — but I cannot afford to hire or pay you.',
    preface4: 'This code is only a basic outline; what it can be carved into depends on your creativity.',
    preface5: 'Monthly license fees gain user support for continuous development. I refuse investors — that would make things too commercial and rushed, which is not what this virtual world needs. User support covering daily expenses is enough. More means faster progress; less means slower. Living and dreaming side by side!',
    preface6: 'If you don\'t want to subscribe but have resources to spare, contact me to discuss collaboration.',
    preface7: 'Salute to all dream-builders! The software is unencrypted — I hope it helps forge your dreams. If you use it online, remember the author\'s life is still quite humble.',
    prefaceDonateTitle: 'Voluntary Sponsorship',
    prefaceDonateText: 'If you believe in our project and wish to further fuel this dream, you can support us more by purchasing additional license time. Every act of kindness is treasured and deeply appreciated. All support will be used entirely for project R&D and continuous iteration.',
    prefaceDonateNotice: 'License is valid only for the current purchased version. After a version upgrade (new version released), you will need to repurchase a license (3 CNY/month). The original license time can still be used with the old version.',
    prefaceFooterLine1: 'Subscribers receive software updates during the authorized version period. A new license purchase is required after version upgrades.',
    prefaceFooterLine2: 'Secondary development based on this program still requires a subscription — supporting the author\'s ongoing improvements. Understanding and forgiveness appreciated!',
    demoTitle: '📷 Screenshot Reference',
    demoDesc: 'Payment proof screenshot should match WeChat Pay detail page style, clearly showing:',
    demoItem1: '✅ Transaction No. (required)',
    demoItem2: 'Merchant No. (optional)',
    demoItem3: '✅ Payment amount',
    demoItem4: '✅ Payee: 米多科技',
    demoItem5: '✅ Payment time',
    termsTitle: 'Subscription Terms of Service',
    termsSubtitle: 'Please read the following terms carefully. You must agree to proceed with payment.',
    termsSection1Title: '1. Service Description',
    termsSection1: 'This subscription service is provided by <span class="terms-highlight">Jinan Miduo Information Technology Co., Ltd.</span>. Users complete subscription renewal by uploading payment proof screenshots. The system will automatically extend your subscription period upon receiving valid proof.',
    termsSection2Title: '2. Simplified Fee Summary',
    termsSection2: 'First subscription: <span class="terms-highlight">¥60</span> (approximately <span class="terms-highlight">$9.18 USD</span>), includes 2 bonus months.<br><br>Per world renewal: <span class="terms-highlight">¥3/month</span> — ¥36/year, ¥360/10 years, ¥3,600/100 years. <span class="terms-warning">Authorization is valid only for the version purchased</span>. When a new version is released, a new license purchase (¥3/month) is required. Existing time authorization remains valid for the old version.<br><br>If a subscription lapses, the maximum re-subscription fee is <span class="terms-warning">¥60</span>. If the lapse exceeds 12 months, re-subscription at ¥60 is required.<br><br>If a subscription is interrupted for more than 12 months, simply pay the maximum ¥60 to obtain the latest system version.<br><br><span style="color:var(--muted);font-size:12px">(This policy is designed to sustain ongoing development and improvement of this system — what we need is long-term, continuous support.)</span>',
    termsSection3Title: '3. Refund Policy',
    termsSection3: 'Due to the proof-based confirmation mechanism, <span class="terms-warning">once payment is confirmed and proof is submitted, no refunds will be issued</span>. Please verify the payment amount and proof information carefully before submitting.',
    termsSection4Title: '4. Service Changes',
    termsSection4: 'We reserve the right to adjust subscription pricing and services based on project development, but benefits for already purchased periods remain unaffected. Price adjustments will be announced in advance.',
    termsSection5Title: '5. Disclaimer & Asset Ownership',
    termsSection5: 'This software is provided "as is" without any express or implied warranty. We only deliver the software program usage license, and assume no liability for any losses caused by force majeure, system maintenance, software bugs, design flaws, server issues, secondary development, or other reasons.<br><br>All virtual assets within a world (including but not limited to images, models, videos, effects, scenes, artwork, etc.) belong to the <span class="terms-highlight">world owner</span>. The world owner bears <span class="terms-warning">full legal responsibility</span> for all assets within their world. Jinan Miduo Information Technology Co., Ltd. <span class="terms-warning">holds no ownership or legal rights whatsoever</span> over any assets or derivative products within any world.',
    termsSection6Title: '6. Intellectual Property',
    termsSection6: 'All code, designs, trademarks, and patents of this system are owned by Jinan Miduo Information Technology Co., Ltd. Subscribers are granted a license for <span class="terms-highlight">commercial use</span>, but <span class="terms-warning">resale and reproduction are strictly prohibited</span>. Violations will face legal liability.',
    termsSection7Title: '7. Governing Law',
    termsSection7: 'These terms are governed by the laws of the People\'s Republic of China. Disputes arising from these terms shall be resolved through friendly negotiation; failing that, they shall be submitted to the Jinan Arbitration Commission.',
    termsSection8Title: '8. Currency Payment Guide',
    termsSection8: 'As long as the payment can be received and we can find a payment record, it works. Other currencies are priced based on the RMB minimum (¥3/month) for conversion.<br><br>Using <span class="terms-highlight">USD</span> as an example: at today\'s real-time market rate of 1 RMB ≈ 0.1475 USD, 3 × 0.1475 = <span class="terms-highlight">0.4425 USD</span> — simply send <span class="terms-highlight">0.443 USD or more</span>. A little extra is appreciated! Though the amount is modest.',
    termsCheckLabel: 'I have read and agree to all the above terms',
    btnTermsAgree: 'Agree & Continue Payment',
    btnTermsCancel: 'Cancel',
    termsMustAgree: 'Please read and agree to the subscription terms of service',
    notLoggedIn: 'Not logged in as admin',
    requestFailed: 'Request failed',
    totalRecords: '{count} records',
    exportSuccess: 'Export successful! {count} records',
    selectPaymentFirst: 'Please select a payment method first',
    selectPaymentToast: 'Please select a payment method',
    uploadProof: 'Please upload payment proof screenshot',
    fillTxnNo: 'Please enter WeChat/Alipay transaction number',
    fillTxnNoToast: 'Please enter transaction number',
    submitting: 'Submitting...',
    qrDemoLabel: 'Screenshot Reference',
    qrDemoPlaceholderText: 'Please save payment detail screenshot as<br>/images/payment_demo.jpg',
    qrDemoItem1: '✅ Transaction No. (required)',
    qrDemoItem2: '✅ Merchant No. (required)',
    qrDemoItem3: '✅ Payment amount',
    qrDemoItem4: '✅ Payee: Miduo Tech',
    qrDemoItem5: '✅ Payment time',
    amountHint: '* USD amount is converted at a reference rate (1 CNY ≈ 0.1475 USD) for reference only.'
  }
};

function t(key) { return i18n[currentLang][key] || key; }
function tf(key, replacements) {
  let str = t(key);
  Object.entries(replacements).forEach(([k, v]) => { str = str.replace(`{${k}}`, v); });
  return str;
}

// ==================== 语言切换 ====================
function switchLang(lang) {
  currentLang = lang;
  document.getElementById('langZh').classList.toggle('active', lang === 'zh');
  document.getElementById('langEn').classList.toggle('active', lang === 'en');
  try { localStorage.setItem('locale', lang === 'en' ? 'en-US' : 'zh-CN'); } catch(e) { /* ignore */ }
  applyTranslations();
}

function applyTranslations() {
  document.getElementById('pageTitle').textContent = t('pageTitle');
  document.getElementById('companyLine').textContent = t('companyLine');
  document.getElementById('statusLabel').textContent = t('statusLabel');
  document.getElementById('sdWorldLabel').textContent = t('sdWorldLabel');
  document.getElementById('sdStartLabel').textContent = t('sdStartLabel');
  document.getElementById('sdExpireLabel').textContent = t('sdExpireLabel');
  document.getElementById('btnHistory').textContent = t('btnHistory');
  document.getElementById('buyTitle').textContent = t('buyTitle');
  document.getElementById('buyMonthsLabel').textContent = t('buyMonthsLabel');
  document.getElementById('buyMonthsUnit').textContent = t('buyMonthsUnit');
  document.getElementById('buyAmountLabel').textContent = t('buyAmountLabel');
  document.getElementById('buyMethodLabel').textContent = t('buyMethodLabel');
  document.getElementById('proofLabel').textContent = t('proofLabel');
  document.getElementById('proofFileBtn').textContent = t('chooseFile');
  const proofFileNameEl = document.getElementById('proofFileName');
  if (proofFileNameEl && !document.getElementById('proofFile').files[0]) {
    proofFileNameEl.textContent = t('noFileChosen');
  }
  document.getElementById('noteInput').placeholder = t('notePlaceholder');
  document.getElementById('txnNoLabel').textContent = t('txnNoLabel');
  document.getElementById('txnNo').placeholder = t('txnNoPlaceholder');
  document.getElementById('orderNoLabel').textContent = t('orderNoLabel');
  document.getElementById('orderNo').placeholder = t('orderNoPlaceholder');
  document.getElementById('btnSubmit').textContent = t('btnSubmit');
  document.getElementById('qrPlaceholder').textContent = t('qrPlaceholder');
  document.getElementById('qrClose').textContent = t('qrClose');

  // 更新许可费用与支付约定
  document.getElementById('companyInfoTitle').textContent = t('companyInfoTitle');
  document.getElementById('licenseTerm1').textContent = t('licenseTerm1');
  document.getElementById('licenseTerm2').textContent = t('licenseTerm2');
  document.getElementById('licenseTerm3').textContent = t('licenseTerm3');
  document.getElementById('licenseTerm4').textContent = t('licenseTerm4');

  // 更新作者前言
  document.getElementById('prefaceTitle').textContent = t('prefaceTitle');
  document.getElementById('preface1').textContent = t('preface1');
  document.getElementById('preface2').textContent = t('preface2');
  document.getElementById('preface3').textContent = t('preface3');
  document.getElementById('preface4').textContent = t('preface4');
  document.getElementById('preface5').textContent = t('preface5');
  document.getElementById('preface6').textContent = t('preface6');
  document.getElementById('preface7').textContent = t('preface7');
  document.getElementById('prefaceDonate').innerHTML = `💝 <strong>${t('prefaceDonateTitle')}</strong><br>${t('prefaceDonateText')}<br><span style="color:var(--orange);font-weight:600">${t('prefaceDonateNotice')}</span>`;
  document.getElementById('prefaceFooter').innerHTML = `${t('prefaceFooterLine1')}<br><strong>${t('prefaceFooterLine2')}</strong>`;

  // 截图演示
  document.getElementById('demoTitle').textContent = t('demoTitle');
  document.getElementById('demoDesc').textContent = t('demoDesc');
  document.getElementById('demoItem1').textContent = t('demoItem1');
  document.getElementById('demoItem2').textContent = t('demoItem2');
  document.getElementById('demoItem3').textContent = t('demoItem3');
  document.getElementById('demoItem4').textContent = t('demoItem4');
  document.getElementById('demoItem5').textContent = t('demoItem5');

  // QR弹窗演示区翻译
  const qrDemoLabel = document.getElementById('qrDemoLabel');
  if (qrDemoLabel) qrDemoLabel.textContent = t('qrDemoLabel');
  const qrDemoPlaceholderTextEl = document.getElementById('qrDemoPlaceholderText');
  if (qrDemoPlaceholderTextEl) qrDemoPlaceholderTextEl.innerHTML = t('qrDemoPlaceholderText');
  const qrDemoItem1El = document.getElementById('qrDemoItem1');
  if (qrDemoItem1El) qrDemoItem1El.textContent = t('qrDemoItem1');
  const qrDemoItem2El = document.getElementById('qrDemoItem2');
  if (qrDemoItem2El) qrDemoItem2El.textContent = t('qrDemoItem2');
  const qrDemoItem3El = document.getElementById('qrDemoItem3');
  if (qrDemoItem3El) qrDemoItem3El.textContent = t('qrDemoItem3');
  const qrDemoItem4El = document.getElementById('qrDemoItem4');
  if (qrDemoItem4El) qrDemoItem4El.textContent = t('qrDemoItem4');
  const qrDemoItem5El = document.getElementById('qrDemoItem5');
  if (qrDemoItem5El) qrDemoItem5El.textContent = t('qrDemoItem5');

  // 更新支付方式选项
  updatePaymentOptions();

  // 更新状态显示
  updateStatusDisplay();

  // 语言切换后重新计算金额显示（货币符号切换）
  calcAmount();

  // 更新金额提示文字（英文模式显示汇率说明）
  const amountHintEl = document.getElementById('amountHint');
  if (amountHintEl) amountHintEl.textContent = t('amountHint');
}

// ==================== 支付方式显示名称 ====================
function getPaymentMethodDisplay(method) {
  if (method === 'free_trial') return t('methodFreeTrial');
  return t('method' + method.charAt(0).toUpperCase() + method.slice(1));
}

// ==================== 支付方式tiles ====================
function updatePaymentOptions() {
  const tiles = document.querySelectorAll('.payment-tile');
  tiles.forEach(tile => {
    const m = tile.getAttribute('data-method');
    const labels = { wechat: t('methodWechat'), alipay: t('methodAlipay'), paypal: t('methodPaypal'), crypto: t('methodCrypto'), bank: t('methodBank') };
    tile.textContent = labels[m] || m;
    tile.classList.toggle('active', m === selectedPaymentMethod);
    // 绑定点击事件（用 on+属性方式避免重复绑定）
    tile.onclick = () => selectPaymentMethod(m);
  });
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  updatePaymentOptions();
  // 点击平铺方式后自动弹出收款账号弹窗
  showPaymentModal();
}

// ==================== 加载订阅数据 ====================
async function loadSubscriptionData() {
  try {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      showToast(t('notLoggedIn'), true);
      setTimeout(() => { window.location.href = '/admin_login.html'; }, 2000);
      return;
    }

    const resp = await fetch('/api/subscription/status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin_login.html';
        return;
      }
      const err = await resp.json();
      showToast(tf('errorMsg', { error: err.error || t('requestFailed') }), true);
      return;
    }

    const data = await resp.json();
    subConfig = data.config;
    subStatus = data.subscription;
    subHistory = data.history || [];

    updatePricingControls();
    updateStatusDisplay();
    calcAmount();
  } catch (error) {
    console.error('[subscription] loadSubscriptionData', error);
  }
}

// ==================== 更新状态显示 ====================
function updateStatusDisplay() {
  const valueEl = document.getElementById('statusValue');

  if (!subConfig) return;

  // 世界ID
  const worldId = subConfig.worldId || 'N/A';
  document.getElementById('sdWorldId').textContent = worldId.length > 12 ? worldId.substring(0, 12) + '…' : worldId;

  if (subStatus) {
    // 开始时间
    const startDate = subStatus.startedAt ? new Date(subStatus.startedAt).toLocaleDateString() : '-';
    document.getElementById('sdStartTime').textContent = startDate;
    // 到期时间
    const expireDate = new Date(subStatus.expiresAt).toLocaleDateString();
    document.getElementById('sdExpireTime').textContent = expireDate;

    if (subStatus.isExpired) {
      // 超期天数 = 从到期日到今天的天数（正数）
      const overdueDays = Math.abs(Math.ceil((new Date() - new Date(subStatus.expiresAt)) / (1000 * 60 * 60 * 24)));
      valueEl.textContent = t('expired') + ' - ' + tf('overdue', { days: overdueDays });
      valueEl.className = 'status-value expired';
    } else {
      valueEl.textContent = t('active') + ' - ' + tf('remaining', { days: subStatus.remainingDays });
      valueEl.className = 'status-value active';
    }
  } else {
    // 无订阅记录，用部署日期推算
    const deployDate = subConfig.deployDate;
    if (deployDate) {
      const startDate = new Date(deployDate).toLocaleDateString();
      document.getElementById('sdStartTime').textContent = startDate;
      // 到期时间 = 部署时间 + 1个月
      const expireDate = new Date(deployDate);
      expireDate.setMonth(expireDate.getMonth() + 1);
      document.getElementById('sdExpireTime').textContent = expireDate.toLocaleDateString();
      // 计算超期天数
      const now = new Date();
      if (now > expireDate) {
        const overdueDays = Math.ceil((now - expireDate) / (1000 * 60 * 60 * 24));
        valueEl.textContent = t('nosub') + ' - ' + tf('overdue', { days: overdueDays });
      } else {
        valueEl.textContent = t('nosub');
      }
    } else {
      document.getElementById('sdStartTime').textContent = '-';
      document.getElementById('sdExpireTime').textContent = '-';
      valueEl.textContent = t('nosub');
    }
    valueEl.className = 'status-value nosub';
  }

  // 更新版本信息
  const sysVer = subConfig.currentVersion || '1.0.0';
  document.getElementById('sdSysVer').textContent = sysVer;
  document.getElementById('sdAuthVerLabel').textContent = t('sdAuthVerLabel');
  document.getElementById('sdSysVerLabel').textContent = t('sdSysVerLabel');

  if (subStatus) {
    const authVer = subStatus.authorizedVersion || '1.0.0';
    document.getElementById('sdAuthVer').textContent = authVer;
    if (subStatus.versionExpired) {
      document.getElementById('sdVerStatusItem').style.display = '';
      document.getElementById('sdVerStatusLabel').textContent = t('sdVerStatusLabel');
      document.getElementById('sdVerStatus').textContent = t('verNeedUpgrade');
      document.getElementById('sdVerStatus').style.color = '#ff8c00';
    } else {
      document.getElementById('sdVerStatusItem').style.display = '';
      document.getElementById('sdVerStatusLabel').textContent = t('sdVerStatusLabel');
      document.getElementById('sdVerStatus').textContent = t('verOk');
      document.getElementById('sdVerStatus').style.color = '#00ff00';
    }
  } else {
    document.getElementById('sdAuthVer').textContent = '-';
    document.getElementById('sdVerStatusItem').style.display = 'none';
  }

  // 更新标签文本
  document.getElementById('sdWorldLabel').textContent = t('sdWorldLabel');
  document.getElementById('sdStartLabel').textContent = t('sdStartLabel');
  document.getElementById('sdExpireLabel').textContent = t('sdExpireLabel');
}

// ==================== 根据计费模式更新控件状态 ====================
function getMinMonths() {
  const state = SubscriptionPricing.getPricingState(subHistory, subConfig, 1);
  return state.mode === 'renew' ? 1 : 2;
}

function updatePricingControls() {
  const minMonths = getMinMonths();
  const state = SubscriptionPricing.getPricingState(subHistory, subConfig, minMonths);
  const monthsInput = document.getElementById('monthsInput');
  if (!monthsInput) return;

  monthsInput.min = minMonths;
  monthsInput.value = state.months;
  monthsInput.disabled = false;
  monthsInput.title = formatPricingDesc(state);
}

// ==================== 计算金额 ====================
function calcAmount() {
  const minMonths = getMinMonths();
  const months = Math.max(minMonths, parseInt(document.getElementById('monthsInput').value) || minMonths);
  document.getElementById('monthsInput').value = months;
  const state = SubscriptionPricing.getPricingState(subHistory, subConfig, months);
  document.getElementById('amountDisplay').textContent = formatAmount(state.amountYuan);
  document.getElementById('monthsInput').title = formatPricingDesc(state);
  return state;
}

// ==================== 支付记录弹窗 ====================
function showHistory() {
  historyPage = 1;
  document.getElementById('historyModalTitle').textContent = t('historyModalTitle');
  renderHistoryModal();
  document.getElementById('historyModal').classList.add('show');
}

function closeHistory() {
  document.getElementById('historyModal').classList.remove('show');
}

function goHistoryPage(dir) {
  const totalPages = Math.ceil((subHistory.length || 1) / pageSize);
  historyPage += dir;
  if (historyPage < 1) historyPage = 1;
  if (historyPage > totalPages) historyPage = totalPages;
  renderHistoryModal();
}

function renderHistoryModal() {
  const listEl = document.getElementById('historyModalList');
  const totalPages = Math.ceil((subHistory.length || 1) / pageSize);

  if (!subHistory || subHistory.length === 0) {
    listEl.innerHTML = `<div class="history-empty">${t('historyEmpty')}</div>`;
  } else {
    const start = (historyPage - 1) * pageSize;
    const pageItems = subHistory.slice(start, start + pageSize);

    listEl.innerHTML = pageItems.map(h => {
      const d = new Date(h.createdAt);
      const dateStr = d.toLocaleDateString();
      const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const methodDisplay = getPaymentMethodDisplay(h.paymentMethod);
      return `
    <div class="history-item">
      <div class="hi-info">
        <div class="hi-date">${dateStr} ${timeStr} · ${methodDisplay}</div>
        <div class="hi-desc">${tf('months', { months: h.months })} — ${tf('hiExpires', { date: new Date(h.expiresAt).toLocaleDateString() })}</div>
        ${h.worldId ? `<div class="hi-detail"><span class="hi-label">${t('hiWorldId')}：</span>${h.worldId}</div>` : ''}
        ${h.txnNo ? `<div class="hi-detail"><span class="hi-label">${t('hiTxnNo')}：</span>${h.txnNo}</div>` : ''}
        ${h.orderNo ? `<div class="hi-detail"><span class="hi-label">${t('hiOrderNo')}：</span>${h.orderNo}</div>` : ''}
        ${h.note ? `<div class="hi-note"><span class="hi-label">${t('hiNote')}：</span>${h.note}</div>` : ''}
        ${h.proofImageUrl ? `<div class="hi-proof-wrap"><img src="${h.proofImageUrl}" class="hi-proof-img" onclick="window.open('${h.proofImageUrl}','_blank')" alt="${t('hiProof')}" title="${t('hiProof')}"></div>` : `<div class="hi-proof-wrap" style="color:var(--muted);font-size:11px">${t('hiNoProof')}</div>`}
      </div>
      <div class="hi-amount">${formatAmount(h.amountYuan)}</div>
    </div>
  `}).join('');
  }

  // 更新分页
  document.getElementById('pageInfo').textContent = tf('historyPage', { page: subHistory.length ? historyPage : 0, total: totalPages });
  document.getElementById('btnPrevPage').disabled = historyPage <= 1;
  document.getElementById('btnNextPage').disabled = historyPage >= totalPages;
  document.getElementById('btnPrevPage').textContent = t('historyPrev');
  document.getElementById('btnNextPage').textContent = t('historyNext');
  document.getElementById('btnCloseHistory').textContent = t('historyClose');
  // 更新导出按钮文本和总数
  const btnExport = document.getElementById('btnExportCSV');
  if (btnExport) btnExport.textContent = t('btnExport');
  const totalCountEl = document.getElementById('historyTotalCount');
  if (totalCountEl) totalCountEl.textContent = tf('totalRecords', { count: subHistory.length });
}

// ==================== 导出支付记录为CSV ====================
function exportHistoryCSV() {
  if (!subHistory || subHistory.length === 0) {
    showToast(t('historyEmpty'), true);
    return;
  }

  // CSV 表头
  const headers = [
    '世界ID', '交易单号(TxnNo)', '经营单号(OrderNo)', '世界地址', '支付方式', '月数',
    '金额(元)', '开始时间', '到期时间', '支付时间', '备注', '凭证图片'
  ];

  // 转义CSV单元格（处理逗号和换行）
  function csvEscape(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // 数据行
  const worldUrl = (subConfig && subConfig.worldUrl) || '';
  const rows = subHistory.map(h => [
    csvEscape(h.worldId || ''),
    csvEscape(h.txnNo || ''),
    csvEscape(h.orderNo || ''),
    csvEscape(worldUrl),
    csvEscape(getPaymentMethodDisplay(h.paymentMethod)),
    h.months,
    h.amountYuan.toFixed(2),
    h.startedAt ? new Date(h.startedAt).toLocaleDateString() : '',
    new Date(h.expiresAt).toLocaleDateString(),
    new Date(h.createdAt).toLocaleDateString(),
    csvEscape(h.note || ''),
    h.proofImageUrl ? h.proofImageUrl : ''
  ]);

  // 生成CSV内容（BOM确保Excel正确识别中文）
  const BOM = '\uFEFF';
  const csvContent = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  // 触发下载
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', t('exportFileName') + '_' +
    new Date().toISOString().split('T')[0] + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(tf('exportSuccess', { count: subHistory.length }));
}

// ==================== 收款账号弹窗 ====================
function showPaymentModal() {
  const method = selectedPaymentMethod;
  const minMonths = getMinMonths();
  const months = Math.max(minMonths, parseInt(document.getElementById('monthsInput').value) || minMonths);
  const state = SubscriptionPricing.getPricingState(subHistory, subConfig, months);
  const total = state.amountYuan;

  const titles = { wechat: 'qrTitleWechat', alipay: 'qrTitleAlipay', paypal: 'qrTitlePaypal', crypto: 'qrTitleCrypto', bank: 'qrTitleBank' };
  const hints = { wechat: 'qrHintWechat', alipay: 'qrHintAlipay', paypal: 'qrHintPaypal', crypto: 'qrHintCrypto', bank: 'qrHintBank' };

  document.getElementById('qrTitle').textContent = t(titles[method] || 'qrTitleWechat');
  document.getElementById('qrHint').textContent = t(hints[method] || 'qrHintWechat');
  document.getElementById('qrAmount').textContent = formatAmount(total);

  // 获取当前支付方式账号配置
  const acct = paymentAccounts[method];

  // 动态更新截图演示图片（主页 + 弹窗）
  const demoImgUrl = acct.demoImageUrl || '';
  const demoImg = document.getElementById('demoImg');
  const qrDemoImg = document.getElementById('qrDemoImg');
  if (demoImg && demoImgUrl) {
    demoImg.src = demoImgUrl + '?t=' + Date.now();
    demoImg.parentElement.style.display = '';
    demoImg.style.display = '';
  } else if (demoImg) {
    demoImg.parentElement.style.display = 'none';
  }
  if (qrDemoImg && demoImgUrl) {
    qrDemoImg.src = demoImgUrl + '?t=' + Date.now();
    qrDemoImg.style.display = '';
    // 同步隐藏 placeholder
    const qrDemoPlaceholder = qrDemoImg.nextElementSibling;
    if (qrDemoPlaceholder && qrDemoPlaceholder.classList.contains('qr-demo-placeholder')) {
      qrDemoPlaceholder.style.display = 'none';
    }
  } else if (qrDemoImg) {
    qrDemoImg.style.display = 'none';
    // 无 demo 图片时显示 placeholder
    const qrDemoPlaceholder = qrDemoImg.nextElementSibling;
    if (qrDemoPlaceholder && qrDemoPlaceholder.classList.contains('qr-demo-placeholder')) {
      qrDemoPlaceholder.style.display = 'flex';
    }
  }

  // 控制右侧截图演示显示（仅二维码类支付方式显示）
  const qrDemoCol = document.getElementById('qrDemoCol');
  if (qrDemoCol) {
    qrDemoCol.style.display = acct.type === 'qr' ? '' : 'none';
  }

  // 控制二维码占位符和账号信息显示
  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const payAccount = document.getElementById('payAccount');

    if (acct.type === 'qr') {
      qrPlaceholder.style.display = '';
      if (acct.qrPlaceholder) {
        qrPlaceholder.innerHTML = t('qrPlaceholder');
      } else if (acct.qrImageUrl) {
        qrPlaceholder.innerHTML = `<img src="${acct.qrImageUrl}" alt="收款码" style="max-width:200px;max-height:200px;border-radius:6px;cursor:zoom-in" onclick="event.stopPropagation();openLightbox('${acct.qrImageUrl}')" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><div style="display:none;font-size:13px;color:#999">${t('qrPlaceholder')}</div>`;
      } else {
        qrPlaceholder.innerHTML = '';
      }
    } else {
    qrPlaceholder.style.display = 'none';
  }

  if (acct.accountLines && acct.accountLines.length > 0) {
    let displayLines = acct.accountLines;
    if (method === 'paypal') {
      displayLines = acct.accountLines.map(url => `${t('paypalPaymentLink')}: ${url}`);
    }
    payAccount.innerHTML = displayLines.map(line => `<div>${line}</div>`).join('');
    payAccount.classList.add('show');
  } else {
    payAccount.classList.remove('show');
  }

  document.getElementById('qrModal').classList.add('show');
}

function closeQR() {
  document.getElementById('qrModal').classList.remove('show');
}

// ==================== 提交购买 ====================
let isSubmitting = false;
let pendingSubmitData = null; // 条款同意后继续使用的表单数据

// ==================== 条款弹窗 ====================
function openTerms() {
  updateTermsTranslations();
  document.getElementById('termsCheckbox').checked = false;
  document.getElementById('termsModal').classList.add('show');
  syncTermsCheckUI();
}

function closeTerms() {
  document.getElementById('termsModal').classList.remove('show');
  pendingSubmitData = null;
}

function toggleTermsCheck() {
  // 点击行时翻转复选框
  const checkbox = document.getElementById('termsCheckbox');
  checkbox.checked = !checkbox.checked;
  // 程序化修改 checked 不会触发 onchange，需手动同步 UI
  syncTermsCheckUI();
}

function syncTermsCheckUI() {
  // 复选框状态变化后同步行样式和按钮状态
  const checkbox = document.getElementById('termsCheckbox');
  const row = document.getElementById('termsCheckRow');
  const btn = document.getElementById('btnTermsAgree');
  row.classList.toggle('checked', checkbox.checked);
  btn.disabled = !checkbox.checked;
}

function confirmTermsAgree() {
  const checkbox = document.getElementById('termsCheckbox');
  if (!checkbox.checked) {
    showToast(t('termsMustAgree'), true);
    return;
  }
  // 先保存数据，再关弹窗（closeTerms 会清空 pendingSubmitData）
  const data = pendingSubmitData;
  closeTerms();
  if (data) {
    doSubmitBuy(data);
  }
}

function updateTermsTranslations() {
  document.getElementById('termsTitle').textContent = t('termsTitle');
  document.getElementById('termsSubtitle').textContent = t('termsSubtitle');
  document.getElementById('termsCheckLabel').textContent = t('termsCheckLabel');
  document.getElementById('btnTermsAgree').textContent = t('btnTermsAgree');
  document.getElementById('btnTermsCancel').textContent = t('btnTermsCancel');

  // 更新条款正文（保留 HTML 样式标签）
  const body = document.getElementById('termsBody');
  const zh = currentLang === 'zh';
  body.innerHTML = [
    `<h4>${zh ? '一、服务说明' : '1. Service Description'}</h4>`,
    `<p>${t('termsSection1')}</p>`,
    `<h4>${zh ? '二、简版订阅费用说明' : '2. Simplified Fee Summary'}</h4>`,
    `<p>${t('termsSection2')}</p>`,
    `<h4>${zh ? '三、退款政策' : '3. Refund Policy'}</h4>`,
    `<p>${t('termsSection3')}</p>`,
    `<h4>${zh ? '四、服务变更' : '4. Service Changes'}</h4>`,
    `<p>${t('termsSection4')}</p>`,
    `<h4>${zh ? '五、免责声明与资产归属' : '5. Disclaimer & Asset Ownership'}</h4>`,
    `<p>${t('termsSection5')}</p>`,
    `<h4>${zh ? '六、知识产权' : '6. Intellectual Property'}</h4>`,
    `<p>${t('termsSection6')}</p>`,
    `<h4>${zh ? '七、法律适用' : '7. Governing Law'}</h4>`,
    `<p>${t('termsSection7')}</p>`,
    `<h4>${zh ? '八、货币收款说明' : '8. Currency Payment Guide'}</h4>`,
    `<p>${t('termsSection8')}</p>`
  ].join('');
}

// ==================== 内联错误提示 ====================
function showInlineError(targetEl, msg) {
  // 移除旧错误
  document.querySelectorAll('.inline-error').forEach(el => el.remove());
  // 移除高亮
  document.querySelectorAll('.form-highlight').forEach(el => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });

  const errEl = document.createElement('div');
  errEl.className = 'inline-error';
  errEl.textContent = '⚠️ ' + msg;
  errEl.style.cssText = 'color:#ff4444;font-size:13px;margin-top:6px;padding:8px 12px;background:rgba(255,68,68,0.1);border-radius:6px;border:1px solid rgba(255,68,68,0.3);animation:shake 0.4s;';
  targetEl.parentNode.insertBefore(errEl, targetEl.nextSibling);

  // 高亮目标区域
  if (targetEl) {
    targetEl.style.borderColor = '#ff4444';
    targetEl.style.boxShadow = '0 0 8px rgba(255,68,68,0.4)';
    targetEl.classList.add('form-highlight');
  }

  // 滚动到目标
  targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 3.5秒后自动清除
  setTimeout(() => {
    if (errEl.parentNode) errEl.remove();
    if (targetEl) {
      targetEl.style.borderColor = '';
      targetEl.style.boxShadow = '';
    }
    document.querySelectorAll('.form-highlight').forEach(el => {
      el.style.borderColor = '';
      el.style.boxShadow = '';
    });
  }, 3500);
}

// 添加抖动动画
if (!document.getElementById('shake-style')) {
  const style = document.createElement('style');
  style.id = 'shake-style';
  style.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}';
  document.head.appendChild(style);
}

async function submitBuy() {
  // 防止重复点击
  if (isSubmitting) {
    return;
  }

  // 校验支付方式
  if (!selectedPaymentMethod) {
    const tiles = document.getElementById('paymentTiles');
    if (tiles) {
      showInlineError(tiles, t('selectPaymentFirst'));
    }
    showToast(t('selectPaymentToast'), true);
    return;
  }

  // 校验凭证截图
  const proofFile = document.getElementById('proofFile').files[0];
  if (!proofFile) {
    const proofInput = document.getElementById('proofFile');
    if (proofInput) {
      showInlineError(proofInput, t('uploadProof'));
    }
    showToast(t('proofRequired'), true);
    return;
  }

  // 校验交易单号
  const txnNo = document.getElementById('txnNo').value.trim();
  if (!txnNo) {
    const txnEl = document.getElementById('txnNo');
    if (txnEl) {
      showInlineError(txnEl, t('fillTxnNo'));
    }
    showToast(t('fillTxnNoToast'), true);
    return;
  }

  // 经营单号（选填）
  const orderNo = document.getElementById('orderNo').value.trim();

  const minMonths = getMinMonths();
  const months = Math.max(minMonths, parseInt(document.getElementById('monthsInput').value) || minMonths);
  const state = SubscriptionPricing.getPricingState(subHistory, subConfig, months);
  const paymentMethod = selectedPaymentMethod;
  const note = document.getElementById('noteInput').value;

  const token = localStorage.getItem('adminToken');
  if (!token) {
    showToast(t('notLoggedIn'), true);
    return;
  }

  // 保存待提交数据，弹出条款弹窗
  pendingSubmitData = { months, paymentMethod, note, proofFile, txnNo, orderNo, token };
  openTerms();
}

// ==================== 实际执行提交（条款同意后调用） ====================
async function doSubmitBuy(data) {
  const { months, paymentMethod, note, proofFile, txnNo, orderNo, token } = data;
  const btnSubmit = document.getElementById('btnSubmit');

  isSubmitting = true;
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = t('submitting');
  }

  const formData = new FormData();
  formData.append('months', months);
  formData.append('payment_method', paymentMethod);
  formData.append('note', note);
  formData.append('proof', proofFile);
  formData.append('txn_no', txnNo);
  formData.append('order_no', orderNo);

  try {
    const resp = await fetch('/api/subscription/buy', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const respData = await resp.json();

    if (resp.ok && respData.success) {
      showSuccessConfirm();
      await loadSubscriptionData();
      document.getElementById('proofFile').value = '';
      const proofFileNameReset = document.getElementById('proofFileName');
      if (proofFileNameReset) {
        proofFileNameReset.textContent = t('noFileChosen');
        proofFileNameReset.style.color = '';
      }
      document.getElementById('noteInput').value = '';
      document.getElementById('monthsInput').value = getMinMonths();
      calcAmount();
    } else {
      if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin_login.html';
        return;
      }
      showToast(tf('errorMsg', { error: respData.error || '未知错误' }), true);
    }
  } catch (error) {
    console.error('[subscription] doSubmitBuy', error);
    showToast(tf('errorMsg', { error: error.message }), true);
  } finally {
    isSubmitting = false;
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = t('btnSubmit');
    }
  }
}

// ==================== Toast通知 ====================
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

// ==================== 支付成功确认弹窗 ====================
function showSuccessConfirm() {
  document.getElementById('successTitle').textContent = t('successTitle');
  document.getElementById('successMsg').textContent = t('successBody');
  document.getElementById('btnSuccessConfirm').textContent = t('successConfirm');
  document.getElementById('successModal').classList.add('show');
}

function closeSuccessConfirm() {
  document.getElementById('successModal').classList.remove('show');
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  // 优先从 localStorage 读取管理后台设置的语言（与 i18n 系统共用 locale key）
  let lang = 'zh';
  try {
    const storedLocale = localStorage.getItem('locale'); // admin i18n 使用 'zh-CN' / 'en-US'
    if (storedLocale === 'en-US') lang = 'en';
  } catch(e) { /* ignore */ }

  // 其次检测浏览器语言
  if (lang === 'zh') {
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang && browserLang.startsWith('en')) lang = 'en';
  }

  switchLang(lang);
  if (lang === 'zh') updatePaymentOptions(); // switchLang('zh') 已调用 applyTranslations，但要补 tile 事件
  loadSubscriptionData();

  // 绑定按钮事件
  const btnHistory = document.getElementById('btnHistory');
  if (btnHistory) {
    btnHistory.addEventListener('click', showHistory);
  }
  const btnCloseHistory = document.getElementById('btnCloseHistory');
  if (btnCloseHistory) {
    btnCloseHistory.addEventListener('click', closeHistory);
  }
  const btnPrev = document.getElementById('btnPrevPage');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => goHistoryPage(-1));
  }
  const btnNext = document.getElementById('btnNextPage');
  if (btnNext) {
    btnNext.addEventListener('click', () => goHistoryPage(1));
  }

  // 绑定确认支付按钮（双保险：onclick + addEventListener）
  const btnSubmit = document.getElementById('btnSubmit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', submitBuy);
  }

  // 自定义文件选择按钮
  const proofFileBtn = document.getElementById('proofFileBtn');
  const proofFileInput = document.getElementById('proofFile');
  const proofFileName = document.getElementById('proofFileName');
  if (proofFileBtn && proofFileInput) {
    proofFileBtn.addEventListener('click', () => proofFileInput.click());
    proofFileInput.addEventListener('change', () => {
      const file = proofFileInput.files[0];
      if (file) {
        if (proofFileName) {
          proofFileName.textContent = file.name;
          proofFileName.style.color = 'var(--text)';
        }
      } else {
        if (proofFileName) {
          proofFileName.textContent = t('noFileChosen');
          proofFileName.style.color = '';
        }
      }
    });
  }

  // 点击弹窗背景关闭
  const historyModal = document.getElementById('historyModal');
  if (historyModal) {
    historyModal.addEventListener('click', (e) => {
      if (e.target === historyModal) closeHistory();
    });
  }
  const qrModal = document.getElementById('qrModal');
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) closeQR();
    });
  }

  // 条款弹窗背景点击关闭
  const termsModal = document.getElementById('termsModal');
  if (termsModal) {
    termsModal.addEventListener('click', (e) => {
      if (e.target === termsModal) closeTerms();
    });
  }

  // 成功确认弹窗背景点击关闭
  const successModal = document.getElementById('successModal');
  if (successModal) {
    successModal.addEventListener('click', (e) => {
      if (e.target === successModal) closeSuccessConfirm();
    });
  }

  // 绑定图片点击放大
  bindZoomImages();
});

// ==================== 图片点击放大 ====================
function openLightbox(src) {
  const lb = document.getElementById('imgLightbox');
  const img = document.getElementById('lightboxImg');
  if (lb && img) {
    img.src = src;
    lb.classList.add('show');
  }
}

function closeLightbox() {
  const lb = document.getElementById('imgLightbox');
  if (lb) lb.classList.remove('show');
}

function bindZoomImages() {
  const imgs = document.querySelectorAll('#demoImg, #qrDemoImg');
  imgs.forEach(img => {
    img.onclick = (e) => {
      e.stopPropagation();
      openLightbox(img.src);
    };
  });
}
