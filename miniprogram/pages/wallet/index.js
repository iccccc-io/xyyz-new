// pages/wallet/index.js
const app = getApp()
const db = wx.cloud.database()

/** 将分格式化为元字符串（保留两位小数） */
function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

/** 格式化时间戳或 Date 对象为 "MM-DD HH:mm" */
function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const LEDGER_TYPE_MAP = {
  PAYMENT: '消费支出',
  SETTLEMENT: '收款入账',
  RECHARGE: '模拟充值',
  REFUND: '退款返还',
  WITHDRAW: '余额提现'
}

Page({
  data: {
    loading: true,
    wallet: null,        // 钱包数据（带格式化字段）
    ledgerList: [],      // 流水列表
    ledgerLoading: false,

    // 设置/修改密码弹窗
    showPwdPanel: false,
    isNewPwd: true,      // true:首次设置  false:修改
    pwdStep: 1,          // 修改时：1=输入旧密码 2=输入新密码 3=确认新密码
    pwdInputArr: [],
    pwdError: '',
    pwdOldInput: '',     // 暂存旧密码
    pwdNewInput: '',     // 暂存新密码

    // 静态常量（模板需要）
    dotIndexes: [0, 1, 2, 3, 4, 5],
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  },

  onLoad() {
    this.loadWallet()
  },

  onShow() {
    // 从支付页返回时刷新余额
    if (this.data.wallet) {
      this.loadWallet()
    }
  },

  /** 加载钱包信息 */
  async loadWallet() {
    const openid = app.globalData.openid
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    try {
      const res = await db.collection('shopping_wallets')
        .where({ _openid: openid })
        .get()

      if (res.data && res.data.length > 0) {
        const raw = res.data[0]
        this.setData({
          wallet: {
            ...raw,
            balanceDisplay: formatFen(raw.balance),
            frozenDisplay: formatFen(raw.frozen_balance || 0)
          },
          loading: false
        })
        this.loadLedger()
      } else {
        // 钱包不存在，自动初始化
        await this.initWallet()
      }
    } catch (err) {
      console.error('加载钱包失败:', err)
      this.setData({ loading: false })
    }
  },

  /** 初始化钱包（新用户兜底） */
  async initWallet() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const addRes = await db.collection('shopping_wallets').add({
        data: {
          balance: 10000,         // 初始赠送 100 元测试金
          frozen_balance: 0,
          pay_password: '',
          status: 1,
          create_time: db.serverDate(),
          update_time: db.serverDate()
        }
      })

      // 写入充值记录
      await db.collection('shopping_ledger').add({
        data: {
          order_id: '',
          user_id: openid,
          type: 'RECHARGE',
          amount: 10000,
          description: '新用户注册赠金 ¥100',
          create_time: db.serverDate()
        }
      })

      this.setData({
        wallet: {
          _id: addRes._id,
          _openid: openid,
          balance: 10000,
          frozen_balance: 0,
          pay_password: '',
          status: 1,
          balanceDisplay: '100.00',
          frozenDisplay: '0.00'
        },
        loading: false
      })
      wx.showToast({ title: '钱包初始化成功', icon: 'success' })
    } catch (err) {
      console.error('初始化钱包失败:', err)
      this.setData({ loading: false })
    }
  },

  /** 加载账单流水 */
  async loadLedger() {
    const openid = app.globalData.openid
    if (!openid) return

    this.setData({ ledgerLoading: true })
    try {
      const res = await db.collection('shopping_ledger')
        .where({ user_id: openid })
        .orderBy('create_time', 'desc')
        .limit(50)
        .get()

      const ledgerList = (res.data || []).map(item => ({
        ...item,
        amountDisplay: (Math.abs(item.amount) / 100).toFixed(2),
        timeDisplay: formatTime(item.create_time)
      }))

      this.setData({ ledgerList, ledgerLoading: false })
    } catch (err) {
      console.error('加载流水失败:', err)
      this.setData({ ledgerLoading: false })
    }
  },

  /** 模拟充值：每次加 10000 分（100 元） */
  async onRecharge() {
    const { wallet } = this.data
    if (!wallet) return

    wx.showModal({
      title: '模拟充值',
      content: '将为您充值 ¥100.00 测试金，确认继续？',
      confirmText: '充值',
      confirmColor: '#8B2E2A',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '充值中...', mask: true })

        try {
          const openid = app.globalData.openid
          const _ = db.command

          await db.collection('shopping_wallets').doc(wallet._id).update({
            data: {
              balance: _.inc(10000),
              update_time: db.serverDate()
            }
          })

          await db.collection('shopping_ledger').add({
            data: {
              order_id: '',
              user_id: openid,
              type: 'RECHARGE',
              amount: 10000,
              description: '模拟充值 ¥100',
              create_time: db.serverDate()
            }
          })

          wx.hideLoading()
          wx.showToast({ title: '充值成功', icon: 'success' })
          this.loadWallet()
        } catch (err) {
          wx.hideLoading()
          console.error('充值失败:', err)
          wx.showToast({ title: '充值失败', icon: 'none' })
        }
      }
    })
  },

  /** 打开设置/修改密码面板 */
  onChangePwd() {
    const { wallet } = this.data
    const isNewPwd = !wallet || !wallet.pay_password
    this.setData({
      showPwdPanel: true,
      isNewPwd,
      pwdStep: isNewPwd ? 2 : 1,  // 设置：直接输新密码；修改：先验旧密码
      pwdInputArr: [],
      pwdError: '',
      pwdOldInput: '',
      pwdNewInput: ''
    })
  },

  closePwdPanel() {
    this.setData({
      showPwdPanel: false,
      pwdInputArr: [],
      pwdError: '',
      pwdOldInput: '',
      pwdNewInput: ''
    })
  },

  /** 密码键盘输入 */
  onPwdKeyTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return

    const { pwdInputArr, isNewPwd, pwdStep, pwdOldInput, pwdNewInput, wallet } = this.data

    if (key === 'del') {
      if (pwdInputArr.length > 0) {
        this.setData({ pwdInputArr: pwdInputArr.slice(0, -1), pwdError: '' })
      }
      return
    }

    if (pwdInputArr.length >= 6) return

    const newArr = [...pwdInputArr, key]
    this.setData({ pwdInputArr: newArr })

    if (newArr.length < 6) return

    // 满 6 位，进行逻辑判断
    const inputStr = newArr.join('')

    if (isNewPwd) {
      // 设置密码：步骤 2 = 输入新密码，步骤 3 = 确认新密码
      if (pwdStep === 2) {
        this.setData({ pwdNewInput: inputStr, pwdStep: 3, pwdInputArr: [], pwdError: '' })
      } else if (pwdStep === 3) {
        if (inputStr !== pwdNewInput) {
          this.setData({ pwdInputArr: [], pwdError: '两次密码不一致，请重新输入' })
        } else {
          this.savePwd(inputStr)
        }
      }
    } else {
      // 修改密码：步骤 1 = 验旧密码，步骤 2 = 输入新密码，步骤 3 = 确认新密码
      if (pwdStep === 1) {
        if (inputStr !== wallet.pay_password) {
          this.setData({ pwdInputArr: [], pwdError: '旧密码错误，请重试' })
        } else {
          this.setData({ pwdOldInput: inputStr, pwdStep: 2, pwdInputArr: [], pwdError: '' })
        }
      } else if (pwdStep === 2) {
        this.setData({ pwdNewInput: inputStr, pwdStep: 3, pwdInputArr: [], pwdError: '' })
      } else if (pwdStep === 3) {
        if (inputStr !== pwdNewInput) {
          this.setData({ pwdInputArr: [], pwdError: '两次密码不一致，请重新输入' })
        } else {
          this.savePwd(inputStr)
        }
      }
    }
  },

  /** 保存支付密码到数据库 */
  async savePwd(newPwd) {
    const { wallet } = this.data
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      await db.collection('shopping_wallets').doc(wallet._id).update({
        data: {
          pay_password: newPwd,
          update_time: db.serverDate()
        }
      })
      wx.hideLoading()
      this.setData({
        showPwdPanel: false,
        pwdInputArr: [],
        pwdError: '',
        wallet: { ...wallet, pay_password: newPwd }
      })
      wx.showToast({ title: '密码设置成功', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error('保存密码失败:', err)
      this.setData({ pwdInputArr: [], pwdError: '保存失败，请重试' })
    }
  },

  onPullDownRefresh() {
    this.loadWallet().then(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 · 我的钱包', path: '/pages/wallet/index' }
  }
})
