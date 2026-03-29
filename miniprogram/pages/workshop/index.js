const app = getApp()
const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')
const { decorateReview, formatScoreValue } = require('../../common/review')

Page({
  data: {
    statusBarHeight: 20,
    workshopId: '',
    workshopInfo: null,
    products: [],
    reviews: [],
    isOwner: false,
    loading: true,
    reviewLoading: false,
    reviewPage: 1,
    reviewHasMore: false,
    showReplyPopup: false,
    replyReviewId: '',
    replyContent: ''
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20
    })

    if (options.id) {
      this.setData({ workshopId: options.id })
      this.loadWorkshopData()
    } else {
      this.loadUserWorkshop()
    }
  },

  async loadUserWorkshop() {
    try {
      const userInfo = app.globalData.userInfo
      if (userInfo && userInfo.workshop_id) {
        this.setData({ workshopId: userInfo.workshop_id })
        await this.loadWorkshopData()
        return
      }

      this.setData({ loading: false })
      wx.showModal({
        title: '提示',
        content: '您还没有创建工坊',
        confirmText: '去认证',
        success: (res) => {
          if (res.confirm) {
            wx.redirectTo({
              url: '/pages/certification/apply'
            })
          } else {
            wx.navigateBack()
          }
        }
      })
    } catch (err) {
      console.error('[workshop] loadUserWorkshop failed:', err)
      this.setData({ loading: false })
    }
  },

  async loadWorkshopData() {
    const workshopId = this.data.workshopId
    if (!workshopId) return

    this.setData({
      loading: true,
      showReplyPopup: false
    })

    try {
      const workshopRes = await db.collection('shopping_workshops').doc(workshopId).get()
      if (!workshopRes.data) {
        this.setData({
          loading: false,
          workshopInfo: null
        })
        return
      }

      const workshopInfo = workshopRes.data
      const isOwner = Boolean(app.globalData.openid && app.globalData.openid === workshopInfo.owner_id)
      const reviewCount = Number(workshopInfo.shop_review_count || 0)
      const shopRating = Number(workshopInfo.shop_rating || workshopInfo.rating || 0)

      this.setData({
        workshopInfo: {
          ...workshopInfo,
          shop_review_count: reviewCount,
          shop_rating: shopRating,
          ratingDisplay: formatScoreValue(shopRating, reviewCount)
        },
        isOwner
      })

      await Promise.all([
        this.loadProducts(),
        this.loadWorkshopReviews(true)
      ])

      this.setData({ loading: false })
    } catch (err) {
      console.error('[workshop] loadWorkshopData failed:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  async loadProducts() {
    try {
      const { workshopId, isOwner } = this.data
      const whereCondition = { workshop_id: workshopId }
      const command = db.command

      if (!isOwner) {
        whereCondition.status = 1
        whereCondition.total_stock = command.gt(0)
        whereCondition.is_on_sale = true
      }

      const productRes = await db.collection('shopping_products')
        .where(whereCondition)
        .orderBy('create_time', 'desc')
        .get()

      const products = (productRes.data || []).map((item) => {
        const summary = createProductSummary(item)
        return {
          ...summary,
          stock: summary.total_stock,
          priceDisplay: `${summary.priceDisplay}${summary.priceSuffix || ''}`
        }
      })

      this.setData({ products })
      return products
    } catch (err) {
      console.error('[workshop] loadProducts failed:', err)
      this.setData({ products: [] })
      return []
    }
  },

  async loadWorkshopReviews(reset = false) {
    if (!this.data.workshopId) return
    if (this.data.reviewLoading && !reset) return

    const nextPage = reset ? 1 : this.data.reviewPage + 1
    this.setData({ reviewLoading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'list_workshop',
          workshop_id: this.data.workshopId,
          page: nextPage,
          page_size: 10
        }
      })

      const result = res.result
      if (!(result && result.success)) {
        throw new Error((result && result.message) || '加载评价失败')
      }

      const nextList = (result.list || []).map((item) => decorateReview(item, { showProductTitle: true }))
      this.setData({
        reviews: reset ? nextList : [...this.data.reviews, ...nextList],
        reviewPage: nextPage,
        reviewHasMore: result.has_more === true,
        reviewLoading: false,
        isOwner: result.is_workshop_owner === true || this.data.isOwner
      })
      return nextList
    } catch (err) {
      console.error('[workshop] loadWorkshopReviews failed:', err)
      this.setData({ reviewLoading: false })
      if (reset) {
        this.setData({ reviews: [], reviewPage: 1, reviewHasMore: false })
      }
      return []
    }
  },

  navigateToProductDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  navigateToPublish() {
    if (!this.data.isOwner) {
      wx.showToast({
        title: '仅工坊主可发布商品',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  previewReviewImages(e) {
    const urls = Array.isArray(e.currentTarget.dataset.urls) ? e.currentTarget.dataset.urls : []
    const index = Number(e.currentTarget.dataset.index || 0)
    if (!urls.length) return

    wx.previewImage({
      urls,
      current: urls[index] || urls[0]
    })
  },

  loadMoreReviews() {
    if (!this.data.reviewHasMore || this.data.reviewLoading) return
    this.loadWorkshopReviews(false)
  },

  openReplyPopup(e) {
    if (!this.data.isOwner) return
    const reviewId = e.currentTarget.dataset.id
    if (!reviewId) return

    this.setData({
      showReplyPopup: true,
      replyReviewId: reviewId,
      replyContent: ''
    })
  },

  closeReplyPopup() {
    this.setData({
      showReplyPopup: false,
      replyReviewId: '',
      replyContent: ''
    })
  },

  onReplyInput(e) {
    this.setData({
      replyContent: e.detail.value
    })
  },

  async submitReply() {
    const reviewId = this.data.replyReviewId
    const content = String(this.data.replyContent || '').trim()
    if (!reviewId) return

    if (!content) {
      wx.showToast({
        title: '请输入回复内容',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: '提交中...',
      mask: true
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'reply_once',
          review_id: reviewId,
          content
        }
      })

      wx.hideLoading()
      const result = res.result
      if (!(result && result.success && result.review)) {
        wx.showToast({
          title: (result && result.message) || '回复失败',
          icon: 'none'
        })
        return
      }

      const nextReview = decorateReview(result.review, { showProductTitle: true })
      const reviews = this.data.reviews.map((item) => (item._id === nextReview._id ? nextReview : item))
      this.setData({
        reviews,
        showReplyPopup: false,
        replyReviewId: '',
        replyContent: ''
      })

      wx.showToast({
        title: '回复成功',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      console.error('[workshop] submitReply failed:', err)
      wx.showToast({
        title: '回复失败',
        icon: 'none'
      })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  onShow() {
    if (this.data.workshopId && this.data.workshopInfo) {
      this.loadWorkshopData()
    }
  },

  onReachBottom() {
    this.loadMoreReviews()
  },

  onPullDownRefresh() {
    if (!this.data.workshopId) {
      wx.stopPullDownRefresh()
      return
    }

    this.loadWorkshopData()
      .finally(() => {
        wx.stopPullDownRefresh()
      })
  }
})
