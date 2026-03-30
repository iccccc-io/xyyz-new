const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const HASH_PREFIX = 'sha256$'
const PAY_PASSWORD_SALT = 'xyyz_wallet_pwd_v1'

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toIntAmount(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.round(num) : fallback
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
    return { ok: false, shouldUpgrade: false }
  }
  if (!/^\d{6}$/.test(input)) {
    return { ok: false, shouldUpgrade: false }
  }
  if (stored.startsWith(HASH_PREFIX)) {
    return {
      ok: stored === hashPayPassword(openid, input),
      shouldUpgrade: false
    }
  }
  if (/^\d{6}$/.test(stored)) {
    return {
      ok: stored === input,
      shouldUpgrade: stored === input
    }
  }
  return {
    ok: stored === hashPayPassword(openid, input),
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

  return res.data[0]
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const amountFen = toIntAmount(event.amount_fen)
  const payPassword = getSafeString(event.pay_password)

  if (!openid) {
    return { success: false, message: '请先登录' }
  }
  if (!Number.isInteger(amountFen) || amountFen <= 0) {
    return { success: false, message: '请输入有效的提现金额' }
  }
  if (!/^\d{6}$/.test(payPassword)) {
    return { success: false, message: '请输入 6 位提现密码' }
  }

  try {
    const user = await getUserByOpenid(openid)
    if (!user || !isCertifiedCreator(user)) {
      return { success: false, message: '仅认证传承人可发起提现' }
    }

    const accountInfo = user.withdraw_account_info || {}
    if (!getSafeString(accountInfo.type) || !getSafeString(accountInfo.account) || !getSafeString(accountInfo.name)) {
      return { success: false, message: '请先设置收款账户信息' }
    }

    const wallet = await ensureWallet(openid)
    const verifyRes = verifyPayPassword(wallet.pay_password, openid, payPassword)
    if (!verifyRes.ok) {
      return { success: false, message: '提现密码错误，请重试' }
    }

    const transaction = await db.startTransaction()
    try {
      const walletTxRes = await transaction.collection('shopping_wallets').doc(wallet._id).get()
      const walletTx = walletTxRes.data || {}
      const latestVerifyRes = verifyPayPassword(walletTx.pay_password, openid, payPassword)
      if (!latestVerifyRes.ok) {
        throw new Error('提现密码错误，请重试')
      }

      const availableBalance = toIntAmount(walletTx.balance)
      if (amountFen > availableBalance) {
        throw new Error('提现金额不能超过可用余额')
      }

      const withdrawalRes = await transaction.collection('shopping_withdrawals').add({
        data: {
          user_id: openid,
          amount: amountFen,
          account_info: {
            type: getSafeString(accountInfo.type),
            account: getSafeString(accountInfo.account),
            name: getSafeString(accountInfo.name)
          },
          status: 0,
          apply_time: db.serverDate(),
          audit_time: null
        }
      })

      const walletUpdate = {
        balance: _.inc(-amountFen),
        update_time: db.serverDate()
      }
      if (latestVerifyRes.shouldUpgrade) {
        walletUpdate.pay_password = hashPayPassword(openid, payPassword)
      }

      await transaction.collection('shopping_wallets').doc(wallet._id).update({
        data: walletUpdate
      })

      await transaction.collection('shopping_ledger').add({
        data: {
          user_id: openid,
          ref_id: withdrawalRes._id,
          amount: -amountFen,
          type: 'WITHDRAW_APPLY',
          description: `提现申请已提交，金额 ¥${(amountFen / 100).toFixed(2)}`,
          create_time: db.serverDate()
        }
      })

      await transaction.commit()

      return {
        success: true,
        message: '提现申请已提交',
        withdrawal_id: withdrawalRes._id
      }
    } catch (txErr) {
      await transaction.rollback().catch(() => {})
      throw txErr
    }
  } catch (err) {
    console.error('[apply_withdraw]', err)
    return { success: false, message: err.message || '提现申请失败' }
  }
}
