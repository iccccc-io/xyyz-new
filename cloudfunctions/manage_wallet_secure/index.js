const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const HASH_PREFIX = 'sha256$'
const PAY_PASSWORD_SALT = 'xyyz_wallet_pwd_v1'
const DEFAULT_LEDGER_LIMIT = 20
const DEFAULT_WITHDRAW_LIMIT = 10
const MAX_LEDGER_LIMIT = 50
const MAX_WITHDRAW_LIMIT = 20

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toIntAmount(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : fallback
}

function clampLimit(value, fallback, max) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.min(Math.floor(num), max)
}

function clampSkip(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.floor(num)
}

function isCertifiedCreator(user = {}) {
  return Number(user.role) === 1 || user.is_certified === true
}

function hashPayPassword(openid, password) {
  return `${HASH_PREFIX}${crypto
    .createHash('sha256')
    .update(`${PAY_PASSWORD_SALT}:${openid}:${password}`)
    .digest('hex')}`
}

function verifyPayPassword(storedPassword, openid, inputPassword) {
  const stored = getSafeString(storedPassword)
  const input = getSafeString(inputPassword)

  if (!stored) {
    return { ok: false, reason: 'unset', shouldUpgrade: false }
  }
  if (!/^\d{6}$/.test(input)) {
    return { ok: false, reason: 'format', shouldUpgrade: false }
  }

  if (stored.startsWith(HASH_PREFIX)) {
    return {
      ok: stored === hashPayPassword(openid, input),
      reason: 'hash',
      shouldUpgrade: false
    }
  }

  if (/^\d{6}$/.test(stored)) {
    return {
      ok: stored === input,
      reason: 'legacy',
      shouldUpgrade: stored === input
    }
  }

  return {
    ok: stored === hashPayPassword(openid, input),
    reason: 'unknown',
    shouldUpgrade: false
  }
}

function createWalletPayload(openid) {
  return {
    _openid: openid,
    balance: 0,
    settling_balance: 0,
    frozen_balance: 0,
    total_income: 0,
    total_withdrawn: 0,
    pay_password: '',
    status: 1,
    create_time: db.serverDate(),
    update_time: db.serverDate()
  }
}

function normalizeWallet(wallet = {}) {
  return {
    _id: wallet._id || '',
    balance: toIntAmount(wallet.balance),
    settling_balance: toIntAmount(wallet.settling_balance),
    frozen_balance: toIntAmount(wallet.frozen_balance),
    total_income: toIntAmount(wallet.total_income),
    total_withdrawn: toIntAmount(wallet.total_withdrawn),
    has_pay_password: Boolean(getSafeString(wallet.pay_password)),
    status: toIntAmount(wallet.status, 1)
  }
}

function normalizeAccountInfo(accountInfo = {}) {
  return {
    type: getSafeString(accountInfo.type),
    account: getSafeString(accountInfo.account),
    name: getSafeString(accountInfo.name)
  }
}

function maskAccount(account) {
  const text = getSafeString(account)
  if (!text) return ''
  if (text.length <= 4) return text
  return `${text.slice(0, 2)}***${text.slice(-2)}`
}

async function getUserByOpenid(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()
  return res.data && res.data.length ? res.data[0] : null
}

async function ensureWallet(openid) {
  let res = await db.collection('shopping_wallets')
    .where({ _openid: openid })
    .limit(1)
    .get()

  if (!res.data || !res.data.length) {
    await db.collection('shopping_wallets').add({
      data: createWalletPayload(openid)
    })
    res = await db.collection('shopping_wallets')
      .where({ _openid: openid })
      .limit(1)
      .get()
  }

  if (!res.data || !res.data.length) {
    throw new Error('钱包初始化失败')
  }

  const wallet = res.data[0]
  const patch = {}

  if (!Number.isFinite(Number(wallet.balance))) patch.balance = 0
  if (!Number.isFinite(Number(wallet.settling_balance))) patch.settling_balance = 0
  if (!Number.isFinite(Number(wallet.frozen_balance))) patch.frozen_balance = 0
  if (!Number.isFinite(Number(wallet.total_income))) patch.total_income = 0
  if (!Number.isFinite(Number(wallet.total_withdrawn))) patch.total_withdrawn = 0
  if (typeof wallet.pay_password !== 'string') patch.pay_password = ''
  if (!Number.isFinite(Number(wallet.status))) patch.status = 1

  if (Object.keys(patch).length) {
    patch.update_time = db.serverDate()
    await db.collection('shopping_wallets').doc(wallet._id).update({ data: patch })
    return { ...wallet, ...patch }
  }

  return wallet
}

async function loadLedgerForUser(userId, skip = 0, limit = DEFAULT_LEDGER_LIMIT) {
  const res = await db.collection('shopping_ledger')
    .where({ user_id: userId })
    .orderBy('create_time', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  const list = (res.data || []).map((item) => ({
    ...item,
    amount: toIntAmount(item.amount)
  }))

  return {
    list,
    has_more: list.length >= limit
  }
}

async function loadWithdrawalsForUser(userId, skip = 0, limit = DEFAULT_WITHDRAW_LIMIT) {
  const res = await db.collection('shopping_withdrawals')
    .where({ user_id: userId })
    .orderBy('apply_time', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  const list = (res.data || []).map((item) => ({
    ...item,
    amount: toIntAmount(item.amount),
    account_info: {
      ...normalizeAccountInfo(item.account_info),
      masked_account: maskAccount(item.account_info && item.account_info.account)
    }
  }))

  return {
    list,
    has_more: list.length >= limit
  }
}

async function getWalletHome(openid, event) {
  const wallet = await ensureWallet(openid)
  const limit = clampLimit(event.limit, DEFAULT_LEDGER_LIMIT, MAX_LEDGER_LIMIT)
  const skip = clampSkip(event.skip)
  const ledgerPayload = await loadLedgerForUser(openid, skip, limit)
  const user = await getUserByOpenid(openid)

  return {
    success: true,
    wallet: normalizeWallet(wallet),
    ledger: ledgerPayload.list,
    ledger_has_more: ledgerPayload.has_more,
    is_creator: isCertifiedCreator(user || {})
  }
}

async function getFinanceCenter(openid, event) {
  const user = await getUserByOpenid(openid)
  if (!user || !isCertifiedCreator(user)) {
    return { success: false, message: '仅认证传承人可查看工坊财务中心' }
  }

  const wallet = await ensureWallet(openid)
  const ledgerLimit = clampLimit(event.ledger_limit, DEFAULT_LEDGER_LIMIT, MAX_LEDGER_LIMIT)
  const ledgerSkip = clampSkip(event.ledger_skip)
  const withdrawLimit = clampLimit(event.withdraw_limit, DEFAULT_WITHDRAW_LIMIT, MAX_WITHDRAW_LIMIT)
  const withdrawSkip = clampSkip(event.withdraw_skip)

  const [ledgerPayload, withdrawalsPayload] = await Promise.all([
    loadLedgerForUser(openid, ledgerSkip, ledgerLimit),
    loadWithdrawalsForUser(openid, withdrawSkip, withdrawLimit)
  ])

  const accountInfo = normalizeAccountInfo(user.withdraw_account_info || {})

  return {
    success: true,
    wallet: normalizeWallet(wallet),
    account_info: {
      ...accountInfo,
      masked_account: maskAccount(accountInfo.account)
    },
    ledger: ledgerPayload.list,
    ledger_has_more: ledgerPayload.has_more,
    withdrawals: withdrawalsPayload.list,
    withdrawals_has_more: withdrawalsPayload.has_more,
    profile: {
      nickname: getSafeString(user.nickname) || '传承人',
      workshop_id: getSafeString(user.workshop_id),
      is_certified: true
    }
  }
}

async function loadLedger(openid, event) {
  const limit = clampLimit(event.limit, DEFAULT_LEDGER_LIMIT, MAX_LEDGER_LIMIT)
  const skip = clampSkip(event.skip)
  const payload = await loadLedgerForUser(openid, skip, limit)
  return {
    success: true,
    list: payload.list,
    has_more: payload.has_more
  }
}

async function loadWithdrawals(openid, event) {
  const user = await getUserByOpenid(openid)
  if (!user || !isCertifiedCreator(user)) {
    return { success: false, message: '仅认证传承人可查看提现记录' }
  }

  const limit = clampLimit(event.limit, DEFAULT_WITHDRAW_LIMIT, MAX_WITHDRAW_LIMIT)
  const skip = clampSkip(event.skip)
  const payload = await loadWithdrawalsForUser(openid, skip, limit)

  return {
    success: true,
    list: payload.list,
    has_more: payload.has_more
  }
}

async function saveAccountInfo(openid, event) {
  const user = await getUserByOpenid(openid)
  if (!user || !isCertifiedCreator(user)) {
    return { success: false, message: '仅认证传承人可设置收款账户' }
  }

  const accountInfo = normalizeAccountInfo(event.account_info || {})
  if (!['alipay', 'wechat'].includes(accountInfo.type)) {
    return { success: false, message: '请选择收款方式' }
  }
  if (accountInfo.account.length < 3) {
    return { success: false, message: '请填写有效的收款账号' }
  }
  if (accountInfo.name.length < 2) {
    return { success: false, message: '请填写真实姓名' }
  }

  await db.collection('users').doc(user._id).update({
    data: {
      withdraw_account_info: accountInfo,
      update_time: db.serverDate()
    }
  })

  return {
    success: true,
    message: '收款账户已保存',
    account_info: {
      ...accountInfo,
      masked_account: maskAccount(accountInfo.account)
    }
  }
}

async function setPayPassword(openid, event) {
  const { old_password = '', new_password = '' } = event
  if (!/^\d{6}$/.test(getSafeString(new_password))) {
    return { success: false, message: '新密码必须是 6 位数字' }
  }

  const wallet = await ensureWallet(openid)
  const hasPassword = Boolean(getSafeString(wallet.pay_password))

  if (hasPassword) {
    const verifyRes = verifyPayPassword(wallet.pay_password, openid, old_password)
    if (!verifyRes.ok) {
      return { success: false, message: '旧密码错误，请重试' }
    }
  }

  await db.collection('shopping_wallets').doc(wallet._id).update({
    data: {
      pay_password: hashPayPassword(openid, new_password),
      update_time: db.serverDate()
    }
  })

  return {
    success: true,
    message: hasPassword ? '密码修改成功' : '密码设置成功'
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = getSafeString(event.action)

  if (!openid) {
    return { success: false, message: '请先登录' }
  }

  try {
    switch (action) {
      case 'get_wallet_home':
        return await getWalletHome(openid, event)
      case 'get_finance_center':
        return await getFinanceCenter(openid, event)
      case 'load_ledger':
        return await loadLedger(openid, event)
      case 'load_withdrawals':
        return await loadWithdrawals(openid, event)
      case 'save_account_info':
        return await saveAccountInfo(openid, event)
      case 'set_pay_password':
        return await setPayPassword(openid, event)
      default:
        return { success: false, message: '未知操作' }
    }
  } catch (err) {
    console.error('[manage_wallet_secure]', action, err)
    return { success: false, message: err.message || '服务端异常' }
  }
}
