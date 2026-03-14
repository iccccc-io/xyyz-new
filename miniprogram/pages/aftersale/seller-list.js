// pages/aftersale/seller-list.js
// 通过云函数 manage_aftersale(load_seller_list) 加载
// 解决卖家无法读取买家创建的售后记录的权限问题

const STATUS_TEXT = {
  0: '待审核', 1: '待寄回', 2: '待验收', 3: '退款成功', '-1': '已拒绝', '-2': '已关闭'
}
const STATUS_COLOR = {
  0: '#ff9500', 1: '#1989fa', 2: '#8B6F47', 3: '#10b981', '-1': '#ee0a24', '-2': '#999'
}

function fmtTime(val) {
  if (!val) return ''
  const d = typeof val === 'string' ? new Date(val) : (val instanceof Date ? val : new Date(val))
  if (isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    activeTab: 0,
    loading: true,
    list: [],
    closedList: [],
    pendingCount: 0
  },

  onLoad() { this.loadData() },
  onShow() { this.loadData() },
  onTabChange(e) { this.setData({ activeTab: e.detail.index }) },

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

      const enrich = (item, orderMap) => ({
        ...item,
        statusText: STATUS_TEXT[String(item.status)] || '未知',
        statusColor: STATUS_COLOR[String(item.status)] || '#999',
        refundDisplay: ((item.refund_fee || 0) / 100).toFixed(2),
        applyTimeDisplay: fmtTime(item.apply_time),
        orderInfo: (orderMap && orderMap[item.order_id]) || { title: '', cover_img: '' }
      })

      const activeList = activeData.success
        ? (activeData.list || []).map(i => enrich(i, activeData.orderMap))
        : []
      const cList = closedData.success
        ? (closedData.list || []).map(i => enrich(i, closedData.orderMap))
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
