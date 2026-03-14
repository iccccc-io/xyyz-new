// pages/order/logistics.js

// 状态码 → 颜色
const STATE_COLORS = {
  '0': '#1989fa',  // 在途
  '1': '#ff9500',  // 揽收
  '2': '#ee0a24',  // 疑难
  '3': '#10b981',  // 签收
  '4': '#ee0a24',  // 退签
  '5': '#1989fa',  // 派送
  '6': '#999'      // 退回
}

Page({
  data: {
    loading: true,
    errorMsg: '',
    orderId: '',
    trackingNumber: '',
    carrierName: '',
    stateDesc: '',
    stateColor: '#1989fa',
    trackData: [],
    isCache: false,
    notice: '',
    latestLocation: {},
    markers: []
  },

  onLoad(options) {
    if (options.orderId) {
      this.setData({ orderId: options.orderId })
      this.queryLogistics(options.orderId)
    } else {
      this.setData({ loading: false, errorMsg: '参数错误' })
    }
  },

  async queryLogistics(orderId) {
    this.setData({ loading: true, errorMsg: '' })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getLogisticsTrack',
        data: { order_id: orderId }
      })

      const result = res.result

      if (result && result.success) {
        const data = result.data || []

        // 解析最新一条轨迹的坐标（用于地图展示）
        let latestLocation = {}
        let markers = []

        if (data.length > 0 && data[0].areaCenter) {
          const coords = data[0].areaCenter.split(',')
          if (coords.length === 2) {
            const longitude = parseFloat(coords[0])
            const latitude = parseFloat(coords[1])
            if (!isNaN(latitude) && !isNaN(longitude)) {
              latestLocation = {
                latitude,
                longitude,
                areaName: data[0].areaName || ''
              }
              markers = [{
                id: 1,
                latitude,
                longitude,
                width: 28,
                height: 28,
                callout: {
                  content: data[0].areaName || '当前位置',
                  display: 'ALWAYS',
                  fontSize: 12,
                  borderRadius: 8,
                  padding: 6,
                  bgColor: '#fff',
                  color: '#333'
                }
              }]
            }
          }
        }

        this.setData({
          loading: false,
          trackingNumber: result.trackingNumber,
          carrierName: result.carrierName || '快递',
          stateDesc: result.stateDesc || '查询中',
          stateColor: STATE_COLORS[result.state] || '#1989fa',
          trackData: data,
          isCache: result.isCache || false,
          notice: result.notice || '',
          latestLocation,
          markers
        })
      } else {
        this.setData({
          loading: false,
          errorMsg: result.message || '查询失败',
          trackingNumber: result.trackingNumber || '',
          carrierName: result.carrierName || ''
        })
      }
    } catch (err) {
      console.error('物流查询异常:', err)
      this.setData({
        loading: false,
        errorMsg: '网络异常，请稍后重试'
      })
    }
  },

  retryQuery() {
    const { orderId } = this.data
    if (orderId) this.queryLogistics(orderId)
  },

  copyTracking() {
    const { trackingNumber } = this.data
    if (!trackingNumber) return
    wx.setClipboardData({
      data: trackingNumber,
      success: () => wx.showToast({ title: '已复制单号', icon: 'success' })
    })
  }
})
