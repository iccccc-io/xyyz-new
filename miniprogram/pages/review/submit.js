const app = getApp()
const db = wx.cloud.database()
const { formatDate } = require('../../common/review')

function formatPrice(fen) {
  return ((Number(fen) || 0) / 100).toFixed(2)
}

function createOrderView(order) {
  const snapshot = order.product_snapshot || {}
  return {
    ...order,
    buyTimeText: formatDate(order.create_time),
    productPriceDisplay: formatPrice(snapshot.price || 0),
    totalPriceDisplay: formatPrice(order.total_price || 0),
    reviewStatus: Number(order.review_status) === 1 ? 1 : 0,
    reviewId: typeof order.review_id === 'string' ? order.review_id : ''
  }
}

Page({
  data: {
    orderId: '',
    order: null,
    loading: true,
    submitting: false,
    fileList: [],
    content: '',
    isAnonymous: false,
    rating: {
      product: 5,
      logis: 5,
      service: 5
    }
  },

  onLoad(options) {
    const orderId = options.orderId || ''
    if (!orderId) {
      wx.showToast({
        title: '缺少订单信息',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    if (!app.checkLogin()) {
      app.requireLogin(`/pages/review/submit?orderId=${orderId}`)
      return
    }

    this.setData({ orderId })
    this.loadOrder(orderId)
  },

  async loadOrder(orderId) {
    this.setData({ loading: true })
    try {
      const res = await db.collection('shopping_orders').doc(orderId).get()
      const raw = res.data
      if (!raw) {
        throw new Error('订单不存在')
      }

      const order = createOrderView(raw)
      if (order.reviewStatus === 1 && order.reviewId) {
        wx.redirectTo({
          url: `/pages/review/detail?reviewId=${order.reviewId}`
        })
        return
      }

      if (order.status !== 40 || order.has_aftersale === true) {
        wx.showToast({
          title: '当前订单不可评价',
          icon: 'none'
        })
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }

      this.setData({
        order,
        loading: false
      })
    } catch (err) {
      console.error('[review/submit] loadOrder failed:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  onRateChange(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({
      [`rating.${key}`]: e.detail
    })
  },

  onContentInput(e) {
    this.setData({
      content: e.detail.value
    })
  },

  onAnonymousChange(e) {
    this.setData({
      isAnonymous: e.detail.value
    })
  },

  afterRead(e) {
    const files = Array.isArray(e.detail.file) ? e.detail.file : [e.detail.file]
    const fileList = [...this.data.fileList]
    files.forEach((file) => {
      fileList.push({
        url: file.url,
        tempFilePath: file.url
      })
    })
    this.setData({ fileList })
  },

  deleteImage(e) {
    const index = e.detail.index
    const fileList = [...this.data.fileList]
    fileList.splice(index, 1)
    this.setData({ fileList })
  },

  async ensureUploadedImages() {
    const result = []
    for (let i = 0; i < this.data.fileList.length; i += 1) {
      const file = this.data.fileList[i]
      const filePath = file.tempFilePath || file.url
      if (!filePath) continue

      if (filePath.startsWith('cloud://')) {
        result.push(filePath)
        continue
      }

      wx.showLoading({
        title: `上传 ${i + 1}/${this.data.fileList.length}`,
        mask: true
      })

      const ext = (filePath.split('.').pop() || 'jpg').replace(/\?.*$/, '')
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `reviews/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
        filePath
      })
      result.push(uploadRes.fileID)
    }
    return result
  },

  async submitReview() {
    if (this.data.submitting || !this.data.order) return

    const content = String(this.data.content || '').trim()
    if (!content && this.data.fileList.length === 0) {
      wx.showToast({
        title: '请填写评价内容或上传图片',
        icon: 'none'
      })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({
      title: '提交中...',
      mask: true
    })

    try {
      const images = await this.ensureUploadedImages()
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'submit',
          order_id: this.data.orderId,
          rating: this.data.rating,
          content,
          images,
          is_anonymous: this.data.isAnonymous
        }
      })

      wx.hideLoading()
      const result = res.result
      if (!(result && result.success && result.review_id)) {
        wx.showToast({
          title: (result && result.message) || '提交失败',
          icon: 'none'
        })
        this.setData({ submitting: false })
        return
      }

      wx.showToast({
        title: '评价提交成功',
        icon: 'success'
      })

      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/review/detail?reviewId=${result.review_id}`
        })
      }, 500)
    } catch (err) {
      wx.hideLoading()
      console.error('[review/submit] submitReview failed:', err)
      wx.showToast({
        title: '提交失败',
        icon: 'none'
      })
      this.setData({ submitting: false })
      return
    }

    this.setData({ submitting: false })
  }
})
