const { decorateReview, formatScoreValue } = require('../../common/review')

Page({
  data: {
    productId: '',
    loading: true,
    listLoading: false,
    reviewList: [],
    page: 1,
    hasMore: false,
    keyword: '',
    filterType: 'all',
    skuId: '',
    skuOptions: [],
    summary: {
      rating_avg: 0,
      review_count: 0,
      displayScore: '暂无评分',
      positive_count: 0,
      negative_count: 0,
      with_image_count: 0
    },
    filterTabs: [
      { key: 'all', label: '全部' },
      { key: 'positive', label: '好评' },
      { key: 'negative', label: '差评' },
      { key: 'with_images', label: '有图' }
    ]
  },

  onLoad(options) {
    const productId = options.productId || ''
    if (!productId) {
      wx.showToast({
        title: '缺少商品信息',
        icon: 'none'
      })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    this.setData({ productId })
    this.loadReviews(true)
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.listLoading) return
    this.loadReviews(false)
  },

  onSearchChange(e) {
    const value = typeof e.detail === 'string'
      ? e.detail
      : (e.detail && typeof e.detail.value === 'string' ? e.detail.value : '')
    this.setData({
      keyword: value
    })
  },

  onSearchConfirm() {
    this.loadReviews(true)
  },

  onSearchClear() {
    this.setData({ keyword: '' })
    this.loadReviews(true)
  },

  onFilterChange(e) {
    const filterType = e.currentTarget.dataset.key
    if (!filterType || filterType === this.data.filterType) return
    this.setData({ filterType })
    this.loadReviews(true)
  },

  onSkuChange(e) {
    const skuId = e.currentTarget.dataset.id || ''
    if (skuId === this.data.skuId) return
    this.setData({ skuId })
    this.loadReviews(true)
  },

  async loadReviews(reset = false) {
    if (this.data.listLoading && !reset) return

    const nextPage = reset ? 1 : this.data.page + 1
    this.setData({
      loading: reset,
      listLoading: true
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'list_product',
          product_id: this.data.productId,
          page: nextPage,
          page_size: 10,
          keyword: this.data.keyword,
          filter_type: this.data.filterType,
          sku_id: this.data.skuId
        }
      })

      const result = res.result
      if (!(result && result.success)) {
        throw new Error((result && result.message) || '加载评价失败')
      }

      const summary = result.summary || {}
      const reviewList = (result.list || []).map((item) => decorateReview(item))
      this.setData({
        loading: false,
        listLoading: false,
        page: nextPage,
        hasMore: result.has_more === true,
        reviewList: reset ? reviewList : [...this.data.reviewList, ...reviewList],
        skuOptions: [{ sku_id: '', sku_name: '全部款式', count: summary.review_count || 0 }, ...(result.sku_options || [])],
        summary: {
          ...summary,
          displayScore: formatScoreValue(summary.rating_avg, summary.review_count)
        }
      })
    } catch (err) {
      console.error('[review/product-list] loadReviews failed:', err)
      this.setData({
        loading: false,
        listLoading: false
      })
      if (reset) {
        this.setData({
          reviewList: [],
          page: 1,
          hasMore: false
        })
      }
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
