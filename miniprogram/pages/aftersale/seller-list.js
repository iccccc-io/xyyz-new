// pages/aftersale/seller-list.js
// 通过云函数 manage_aftersale(load_seller_list) 加载
// 解决卖家无法读取买家创建的售后记录的权限问题

const STATUS_TEXT = {
  0: '待审核', 1: '待寄回', 2: '待验收', 3: '退款成功', '-1': '已拒绝', '-2': '已关闭'
}
const STATUS_COLOR = {
  0: '#ff9500', 1: '#1989fa', 2: '#8B6F47', 3: '#10b981', '-1': '#ee0a24', '-2': '#999'
}

const TAB_ITEMS = [
  { index: 0, label: '待处理' },
  { index: 1, label: '已完结' }
]

function fmtTime(val) {
  if (!val) return ''
  const d = typeof val === 'string' ? new Date(val) : (val instanceof Date ? val : new Date(val))
  if (isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function getStickyTopPx() {
  try {
    const systemInfo = wx.getSystemInfoSync()
    const statusBarHeight = systemInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect()
    const navHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height
    return statusBarHeight + (navHeight || 44)
  } catch (err) {
    return 64
  }
}

Page({
  data: {
    activeTab: 0,
    loading: true,
    stickyTopPx: 64,
    tabItems: TAB_ITEMS,
    list: [],
    closedList: [],
    pendingCount: 0
  },

  onLoad() {
    this.setData({ stickyTopPx: getStickyTopPx() })
    this.loadData()
  },
  onShow() { this.loadData() },
  onTabChange(e) {
    const nextIndex = e.currentTarget && e.currentTarget.dataset
      ? Number(e.currentTarget.dataset.index)
      : Number(e.detail.index)
    if (Number.isNaN(nextIndex) || nextIndex === this.data.activeTab) return
    this.setData({ activeTab: nextIndex })
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      // 并行加载进行中和已完结
      const [activeRes, closedRes] = await Promise.all([
        wx.cloud.callFunction({
          name: 'manage_aftersale',
          data: { action: 'load_seller_list', status_filter: 'active' }
        }),
        wx.cloud.callFunction({
          name: 'manage_aftersale',
          data: { action: 'load_seller_list', status_filter: 'closed' }
        })
      ])

      const activeData = activeRes.result
      const closedData = closedRes.result

      const enrich = (item, orderMap, index) => ({
        ...item,
        statusText: STATUS_TEXT[String(item.status)] || '未知',
        statusColor: STATUS_COLOR[String(item.status)] || '#999',
        refundDisplay: ((item.refund_fee || 0) / 100).toFixed(2),
        applyTimeDisplay: fmtTime(item.apply_time),
        typeText: item.type === 'refund_only' ? '仅退款' : '退货退款',
        actionText: item.status === 0 ? '去处理' : item.status === 2 ? '去验收' : '查看详情',
        statusClass: item.status === 3
          ? 'status-success'
          : item.status < 0
            ? 'status-muted'
            : item.status === 2
              ? 'status-brown'
              : 'status-warn',
        orderInfo: (orderMap && orderMap[item.order_id]) || { title: '', cover_img: '' },
        cardDelay: index * 60
      })

      const activeList = activeData.success
        ? (activeData.list || []).map((i, index) => enrich(i, activeData.orderMap, index))
        : []
      const cList = closedData.success
        ? (closedData.list || []).map((i, index) => enrich(i, closedData.orderMap, index))
        : []

      this.setData({
        loading: false,
        list: activeList,
        closedList: cList,
        pendingCount: activeList.filter(i => i.status === 0).length
      })
    } catch (err) {
      console.error('加载售后列表失败:', err)
      this.setData({ loading: false })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/aftersale/detail?id=${id}&from=seller` })
  }
})
