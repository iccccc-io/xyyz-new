const { decorateReview } = require('../../common/review')

Page({
  data: {
    loading: true,
    review: null
  },

  onLoad(options) {
    const reviewId = options.reviewId || ''
    if (!reviewId) {
      wx.showToast({
        title: '缺少评价信息',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    this.loadReview(reviewId)
  },

  async loadReview(reviewId) {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'get_detail',
          review_id: reviewId
        }
      })

      const result = res.result
      if (!(result && result.success && result.review)) {
        throw new Error((result && result.message) || '加载评价失败')
      }

      this.setData({
        loading: false,
        review: decorateReview(result.review, { showProductTitle: true })
      })
    } catch (err) {
      console.error('[review/detail] loadReview failed:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载评价失败',
        icon: 'none'
      })
    }
  },

  previewImages(e) {
    const urls = Array.isArray(e.currentTarget.dataset.urls) ? e.currentTarget.dataset.urls : []
    const index = Number(e.currentTarget.dataset.index || 0)
    if (!urls.length) return

    wx.previewImage({
      urls,
      current: urls[index] || urls[0]
    })
  }
})
