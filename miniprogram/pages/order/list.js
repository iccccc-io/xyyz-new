// pages/order/list.js
const app = getApp()
const db = wx.cloud.database()

const STATUS_MAP = {
  10: { text: '待付款', style: 'status-pending-pay' },
  20: { text: '待发货', style: 'status-pending-ship' },
  30: { text: '待收货', style: 'status-shipped' },
  40: { text: '已完成', style: 'status-done' },
  50: { text: '已取消', style: 'status-cancelled' },
  60: { text: '售后中', style: 'status-aftersale' }
}

function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TIMEOUT_MS = 30 * 60 * 1000

function calcCountdown(createTime) {
  if (!createTime) return { countdown: 0, countdownDisplay: '' }
  const deadline = new Date(createTime).getTime() + TIMEOUT_MS
  const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000))
  if (remaining === 0) return { countdown: 0, countdownDisplay: '' }
  const pad = n => String(n).padStart(2, '0')
  return {
    countdown: remaining,
    countdownDisplay: `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`
  }
}

function enrichOrder(order) {
  let info = STATUS_MAP[order.status] || { text: '未知', style: '' }
  if (order.status === 40 && order.has_aftersale) {
    info = { text: '售后中', style: 'status-aftersale' }
  }
  if (order.status === 60 && (order.aftersale_result === 'refunded' || order.settled === true)) {
    info = { text: '已退款', style: 'status-refunded' }
  }
  const ct = order.status === 10 ? calcCountdown(order.create_time) : {}
  return {
    ...order,
    statusText: info.text,
    statusStyle: info.style,
    totalDisplay: formatFen(order.total_price),
    productPriceDisplay: formatFen(
      order.product_snapshot ? order.product_snapshot.price : 0
    ),
    createTimeDisplay: formatTime(order.create_time),
    ...ct
  }
}

Page({
  data: {
    loading: true,
    activeTab: 'all',
    orders: [],
    hasMore: false,
    navBarHeight: 44,
    // 支付键盘（为 status=10 的订单续付）
    showPayKeyboard: false,
    paying: false,
    payAmountDisplay: '0.00',
    pendingOrderId: '',
    pendingOrderIdx: -1
  },

  _countdownTimer: null,

  _startCountdownRefresh() {
    this._stopCountdownRefresh()
    this._countdownTimer = setInterval(() => {
      const orders = this.data.orders
      // 找出 status=10 的订单，更新倒计时
      const hasPending = orders.some(o => o.status === 10)
      if (!hasPending) { this._stopCountdownRefresh(); return }
      const updated = orders.map(o => {
        if (o.status !== 10) return o
        const ct = calcCountdown(o.create_time)
        return { ...o, ...ct }
      })
      this.setData({ orders: updated })
    }, 1000)
  },

  _stopCountdownRefresh() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
  },

  onUnload() {
    this._stopCountdownRefresh()
  },

  onLoad(options) {
    // 支持跳转时携带 status 直接定位 Tab
    const statusParam = options.status
    const tabMap = { '10': '10', '20': '20', '30': '30', '40': '40', '60': '60' }
    const activeTab = tabMap[statusParam] || 'all'
    this.setData({ activeTab })
    this._skip = 0
    this.loadOrders(true)
  },

  onShow() {
    // 每次显示时刷新（支付/收货后返回）
    this._skip = 0
    this.loadOrders(true)
  },

  onPullDownRefresh() {
    this._skip = 0
    this.loadOrders(true).then(() => wx.stopPullDownRefresh())
  },

  onTabChange(e) {
    const tab = e.detail.name
    this.setData({ activeTab: tab, orders: [] })
    this._skip = 0
    this.loadOrders(true)
  },

  /** 加载订单列表 */
  async loadOrders(reset = false) {
    if (!app.checkLogin()) return

    const openid = app.globalData.openid
    if (!openid) return

    if (reset) {
      this._skip = 0
      this.setData({ loading: true, orders: [] })
    }

    const LIMIT = 10
    const { activeTab } = this.data

    const _ = db.command
    try {
      let query = db.collection('shopping_orders').where({ _openid: openid })

      if (activeTab === '60') {
        // 售后 tab：status=60 或 has_aftersale=true
        query = db.collection('shopping_orders').where(_.and([
          { _openid: openid },
          _.or([{ status: 60 }, { has_aftersale: true }])
        ]))
      } else if (activeTab !== 'all') {
        query = db.collection('shopping_orders').where({
          _openid: openid,
          status: Number(activeTab)
        })
      }

      const res = await query
        .orderBy('create_time', 'desc')
        .skip(this._skip)
        .limit(LIMIT)
        .get()

      const newOrders = (res.data || []).map(enrichOrder)

      const mergedOrders = reset ? newOrders : [...this.data.orders, ...newOrders]
      this.setData({
        orders: mergedOrders,
        hasMore: newOrders.length === LIMIT,
        loading: false
      })
      this._skip += newOrders.length

      // 有待付款订单时启动倒计时刷新
      if (mergedOrders.some(o => o.status === 10)) {
        this._startCountdownRefresh()
      }
    } catch (err) {
      console.error('加载订单失败:', err)
      this.setData({ loading: false })
    }
  },

  loadMore() {
    if (!this.data.hasMore) return
    this.loadOrders(false)
  },

  /** 取消待付款订单 → 调用 cancel_order 云函数 */
  cancelOrder(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '取消订单',
      content: '确定要取消此订单吗？',
      confirmText: '确认取消',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '取消中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'cancel_order',
            data: { order_id: id }
          })
          wx.hideLoading()
          const result = cfRes.result
          if (result && result.success) {
            wx.showToast({ title: '订单已取消', icon: 'success' })
            setTimeout(() => { this._skip = 0; this.loadOrders(true) }, 800)
          } else {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '取消失败，请重试', icon: 'none' })
        }
      }
    })
  },

  /** 续付：打开支付键盘 */
  payOrder(e) {
    const { id, total, idx } = e.currentTarget.dataset
    this.setData({
      pendingOrderId: id,
      pendingOrderIdx: Number(idx),
      payAmountDisplay: total,
      showPayKeyboard: true
    })
  },

  closePayKeyboard() {
    this.setData({ showPayKeyboard: false, pendingOrderId: '', pendingOrderIdx: -1 })
  },

  async onPayConfirm(e) {
    const { password } = e.detail
    const { pendingOrderId } = this.data
    if (!pendingOrderId) return

    this.setData({ paying: true })
    const keyboard = this.selectComponent('#payKeyboard')

    try {
      const res = await wx.cloud.callFunction({
        name: 'process_payment',
        data: { order_id: pendingOrderId, pay_password: password }
      })
      const result = res.result
      if (result && result.success) {
        this.setData({ showPayKeyboard: false, paying: false })
        wx.showToast({ title: '支付成功', icon: 'success' })
        setTimeout(() => { this._skip = 0; this.loadOrders(true) }, 800)
      } else {
        this.setData({ paying: false })
        if (keyboard) keyboard.setError(result.message || '支付失败')
      }
    } catch (err) {
      this.setData({ paying: false })
      if (keyboard) keyboard.setError('网络异常，请重试')
    }
  },

  /** 确认收货 */
  confirmReceipt(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '确认收货',
      content: '请确认您已收到商品。确认后进入7天售后保障期，期内可申请退货退款。',
      confirmText: '确认收货',
      confirmColor: '#8B2E2A',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'confirm_receipt',
            data: { order_id: id }
          })
          wx.hideLoading()
          const result = cfRes.result
          if (result && result.success) {
            wx.showToast({ title: '收货确认成功', icon: 'success' })
            setTimeout(() => { this._skip = 0; this.loadOrders(true) }, 800)
          } else {
            wx.showToast({ title: result.message || '操作失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常，请重试', icon: 'none' })
        }
      }
    })
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/order/detail?id=${id}` })
  },

  viewLogistics(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/order/logistics?orderId=${id}` })
  },

  /** 查看售后进度（通过云函数查找关联的售后记录再跳转） */
  async viewAftersale(e) {
    const orderId = e.currentTarget.dataset.id
    wx.showLoading({ title: '加载中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: { action: 'load_detail', order_id: orderId }
      })
      wx.hideLoading()
      const r = res.result
      if (r && r.success && r.detail) {
        wx.navigateTo({ url: `/pages/aftersale/detail?id=${r.detail._id}` })
      } else {
        wx.showToast({ title: '未找到售后记录', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '查询失败', icon: 'none' })
    }
  },

  goToMall() {
    wx.switchTab({ url: '/pages/mall/home' })
  }
})
