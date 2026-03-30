const app = getApp()

function formatFen(fen) {
  if (fen !== 0 && !fen) return '0.00'
  return (Number(fen) / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function decorateLedgerItem(item = {}) {
  const type = item.type || ''
  const amount = Number(item.amount) || 0

  let iconName = 'refund-o'
  let iconClass = 'icon-other'

  if (type === 'PAYMENT') {
    iconName = 'balance-o'
    iconClass = 'icon-pay'
  } else if (type === 'SETTLED') {
    iconName = 'after-sale'
    iconClass = 'icon-in'
  } else if (type === 'WITHDRAW_APPLY') {
    iconName = 'balance-o'
    iconClass = 'icon-out'
  } else if (type === 'WITHDRAW_REJECT') {
    iconName = 'refund-o'
    iconClass = 'icon-in'
  } else if (type === 'REFUND') {
    iconName = 'refund-o'
    iconClass = amount >= 0 ? 'icon-in' : 'icon-out'
  }

  return {
    ...item,
    amount,
    amountDisplay: (Math.abs(amount) / 100).toFixed(2),
    timeDisplay: formatTime(item.create_time),
    iconName,
    iconClass
  }
}

Page({
  data: {
    loading: true,
    wallet: null,
    ledgerList: [],
    ledgerLoading: false,
    isCreator: false,

    showPwdPanel: false,
    isNewPwd: true,
    pwdStep: 1,
    pwdInputArr: [],
    pwdError: '',
    pwdOldInput: '',
    pwdNewInput: '',

    dotIndexes: [0, 1, 2, 3, 4, 5],
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  },

  onLoad() {
    this.loadWalletHome()
  },

  onShow() {
    if (app.globalData.userInfo) {
      this.loadWalletHome()
    }
  },

  async loadWalletHome() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    this.setData({ loading: true, ledgerLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'get_wallet_home',
          skip: 0,
          limit: 30
        }
      })

      const result = res.result || {}
      if (!result.success) {
        throw new Error(result.message || '钱包加载失败')
      }

      const wallet = result.wallet || {}
      const ledgerList = (result.ledger || []).map(decorateLedgerItem)

      this.setData({
        loading: false,
        ledgerLoading: false,
        isCreator: !!result.is_creator,
        wallet: {
          ...wallet,
          balanceDisplay: formatFen(wallet.balance),
          frozenDisplay: formatFen(wallet.frozen_balance || 0),
          settlingDisplay: formatFen(wallet.settling_balance || 0)
        },
        ledgerList
      })
    } catch (err) {
      console.error('加载钱包失败:', err)
      this.setData({
        loading: false,
        ledgerLoading: false,
        wallet: null,
        ledgerList: []
      })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onChangePwd() {
    const wallet = this.data.wallet || {}
    const isNewPwd = !wallet.has_pay_password
    this.setData({
      showPwdPanel: true,
      isNewPwd,
      pwdStep: isNewPwd ? 2 : 1,
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

  onPwdKeyTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return

    const { pwdInputArr, isNewPwd, pwdStep } = this.data

    if (key === 'del') {
      if (pwdInputArr.length > 0) {
        this.setData({ pwdInputArr: pwdInputArr.slice(0, -1), pwdError: '' })
      }
      return
    }

    if (pwdInputArr.length >= 6) return

    const newArr = [...pwdInputArr, key]
    this.setData({ pwdInputArr: newArr, pwdError: '' })

    if (newArr.length < 6) return

    const inputStr = newArr.join('')

    if (isNewPwd) {
      if (pwdStep === 2) {
        this.setData({ pwdNewInput: inputStr, pwdStep: 3, pwdInputArr: [], pwdError: '' })
      } else if (pwdStep === 3) {
        if (inputStr !== this.data.pwdNewInput) {
          this.setData({ pwdInputArr: [], pwdError: '两次密码不一致，请重新输入' })
        } else {
          this.savePwd(inputStr)
        }
      }
      return
    }

    if (pwdStep === 1) {
      this.setData({
        pwdOldInput: inputStr,
        pwdStep: 2,
        pwdInputArr: [],
        pwdError: ''
      })
    } else if (pwdStep === 2) {
      this.setData({
        pwdNewInput: inputStr,
        pwdStep: 3,
        pwdInputArr: [],
        pwdError: ''
      })
    } else if (pwdStep === 3) {
      if (inputStr !== this.data.pwdNewInput) {
        this.setData({ pwdInputArr: [], pwdError: '两次密码不一致，请重新输入' })
      } else {
        this.savePwd(inputStr)
      }
    }
  },

  async savePwd(newPwd) {
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_wallet_secure',
        data: {
          action: 'set_pay_password',
          old_password: this.data.isNewPwd ? '' : this.data.pwdOldInput,
          new_password: newPwd
        }
      })

      wx.hideLoading()
      const result = res.result || {}
      if (!result.success) {
        this.setData({ pwdInputArr: [], pwdError: result.message || '保存失败，请重试' })
        return
      }

      this.setData({
        showPwdPanel: false,
        pwdInputArr: [],
        pwdError: '',
        pwdOldInput: '',
        pwdNewInput: '',
        'wallet.has_pay_password': true
      })
      wx.showToast({ title: result.message || '密码设置成功', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error('保存密码失败:', err)
      this.setData({ pwdInputArr: [], pwdError: '保存失败，请重试' })
    }
  },

  goToFinance() {
    if (!this.data.isCreator) return
    wx.navigateTo({
      url: '/pages/workshop/finance/index'
    })
  },

  onPullDownRefresh() {
    this.loadWalletHome().finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 · 我的钱包', path: '/pages/wallet/index' }
  }
})
