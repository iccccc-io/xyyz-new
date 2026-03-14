// pages/order/seller-list.js
const app = getApp()

const STATUS_MAP = {
  20: { text: '待发货', style: 'status-pending-ship' },
  30: { text: '已发货', style: 'status-shipped' },
  40: { text: '已完成', style: 'status-done' }
}

const CARRIERS = [
  { code: 'SF',   name: '顺丰速运' },
  { code: 'YTO',  name: '圆通快递' },
  { code: 'ZTO',  name: '中通快递' },
  { code: 'STO',  name: '申通快递' },
  { code: 'YUNDA',name: '韵达快递' },
  { code: 'JD',   name: '京东快递' },
  { code: 'EMS',  name: 'EMS邮政' },
  { code: 'OTHER',name: '其他快递' }
]

function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function enrichOrder(order) {
  const info = STATUS_MAP[order.status] || { text: '未知', style: '' }
  return {
    ...order,
    statusText: info.text,
    statusStyle: info.style,
    totalDisplay: formatFen(order.total_price),
    productPriceDisplay: formatFen(
      order.product_snapshot ? order.product_snapshot.price : 0
    ),
    shipTimeDisplay: formatTime(order.ship_time)
  }
}

Page({
  data: {
    loading: true,
    activeTab: '20',
    orders: [],
    hasMore: false,
    carriers: CARRIERS,

    // 发货弹窗
    showShipDialog: false,
    shipping: false,
    shipTargetId: '',
    shipTargetIdx: -1,
    shipForm: {
      carrier_code: '',
      carrier_name: '',
      tracking_number: ''
    }
  },

  onLoad() {
    this._skip = 0
    this.loadOrders(true)
  },

  onShow() {
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

  /** 调用 get_seller_orders 云函数（绕过数据库权限） */
  async loadOrders(reset = false) {
    if (reset) {
      this._skip = 0
      this.setData({ loading: true, orders: [] })
    }

    const LIMIT = 10
    const { activeTab } = this.data

    try {
      const res = await wx.cloud.callFunction({
        name: 'get_seller_orders',
        data: {
          status: Number(activeTab),
          limit: LIMIT,
          skip: this._skip
        }
      })

      const result = res.result

      if (!result.success) {
        wx.showToast({ title: result.message || '加载失败', icon: 'none' })
        this.setData({ loading: false })
        return
      }

      const newOrders = (result.data || []).map(enrichOrder)

      this.setData({
        orders: reset ? newOrders : [...this.data.orders, ...newOrders],
        hasMore: newOrders.length === LIMIT,
        loading: false
      })

      this._skip += newOrders.length
    } catch (err) {
      console.error('加载销售订单失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  loadMore() {
    if (!this.data.hasMore) return
    this.loadOrders(false)
  },

  /** 打开发货弹窗 */
  openShipDialog(e) {
    const { id, idx } = e.currentTarget.dataset
    this.setData({
      showShipDialog: true,
      shipTargetId: id,
      shipTargetIdx: Number(idx),
      shipping: false,
      shipForm: { carrier_code: '', carrier_name: '', tracking_number: '' }
    })
  },

  closeShipDialog() {
    this.setData({ showShipDialog: false })
  },

  selectCarrier(e) {
    const { code, name } = e.currentTarget.dataset
    this.setData({ 'shipForm.carrier_code': code, 'shipForm.carrier_name': name })
  },

  onTrackingInput(e) {
    this.setData({ 'shipForm.tracking_number': e.detail })
  },

  /** 提交发货 → 调用 ship_order 云函数 */
  async submitShip() {
    const { shipTargetId, shipForm, shipping } = this.data
    if (shipping) return

    if (!shipForm.carrier_code) {
      wx.showToast({ title: '请选择快递公司', icon: 'none' })
      return
    }
    if (!shipForm.tracking_number || shipForm.tracking_number.trim().length < 5) {
      wx.showToast({ title: '请输入有效的快递单号', icon: 'none' })
      return
    }

    this.setData({ shipping: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'ship_order',
        data: {
          order_id: shipTargetId,
          carrier_code: shipForm.carrier_code,
          tracking_number: shipForm.tracking_number.trim()
        }
      })

      const result = res.result

      if (result && result.success) {
        this.setData({ showShipDialog: false, shipping: false })
        wx.showToast({ title: '发货成功', icon: 'success' })
        setTimeout(() => { this._skip = 0; this.loadOrders(true) }, 800)
      } else {
        this.setData({ shipping: false })
        wx.showToast({ title: result.message || '发货失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ shipping: false })
      console.error('发货失败:', err)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  /** 查看物流详情 */
  viewLogistics(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/order/logistics?orderId=${id}` })
  }
})
