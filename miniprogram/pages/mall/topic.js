const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')

Page({
  data: {
    keyword: '',
    topicConfig: {
      手工体验: {
        title: '手工体验',
        subtitle: '亲手触摸非遗的温度',
        icon: 'gift-o',
        color: '#E8846B'
      },
      非遗摆件: {
        title: '非遗摆件',
        subtitle: '匠心独运的艺术珍品',
        icon: 'gem-o',
        color: '#7B68A6'
      },
      地道风物: {
        title: '地道风物',
        subtitle: '来自湖湘的地道好物',
        icon: 'shop-o',
        color: '#5B9A8B'
      },
      文房雅器: {
        title: '文房雅器',
        subtitle: '书房案头的风雅之选',
        icon: 'edit',
        color: '#6B5B4F'
      }
    },
    currentTopic: null,
    leftColumn: [],
    rightColumn: [],
    loading: true,
    loadingMore: false,
    noMore: false,
    page: 0,
    pageSize: 10
  },

  onLoad(options) {
    const keyword = decodeURIComponent(options.keyword || '')
    if (!keyword) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const topicConfig = this.data.topicConfig[keyword] || {
      title: keyword,
      subtitle: '精选好物',
      icon: 'label-o',
      color: '#8B2E2A'
    }

    this.setData({
      keyword,
      currentTopic: topicConfig
    })

    wx.setNavigationBarTitle({
      title: topicConfig.title
    })

    this.loadProducts(true)
  },

  async loadProducts(refresh = false) {
    if (this.data.loadingMore && !refresh) return
    if (this.data.noMore && !refresh) return

    if (refresh) {
      this.setData({
        leftColumn: [],
        rightColumn: [],
        page: 0,
        noMore: false,
        loading: true
      })
    } else {
      this.setData({ loadingMore: true })
    }

    try {
      const { keyword, page, pageSize } = this.data
      const _ = db.command
      const res = await db.collection('shopping_products')
        .where({
          tags: keyword,
          status: 1,
          total_stock: _.gt(0),
          is_on_sale: true
        })
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const products = (res.data || []).map((item) => {
        const summary = createProductSummary(item)
        return {
          ...summary,
          priceDisplay: `${summary.priceDisplay}${summary.priceSuffix}`
        }
      })

      if (products.length < pageSize) {
        this.setData({ noMore: true })
      }

      const left = refresh ? [] : [...this.data.leftColumn]
      const right = refresh ? [] : [...this.data.rightColumn]

      products.forEach((item) => {
        if (left.length <= right.length) {
          left.push(item)
        } else {
          right.push(item)
        }
      })

      this.setData({
        leftColumn: left,
        rightColumn: right,
        page: page + 1,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({
        loading: false,
        loadingMore: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  onReachBottom() {
    this.loadProducts(false)
  },

  onPullDownRefresh() {
    this.loadProducts(true).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onShareAppMessage() {
    const { keyword, currentTopic } = this.data
    return {
      title: `湘韵遗珍 · ${currentTopic ? currentTopic.title : keyword}`,
      path: `/pages/mall/topic?keyword=${encodeURIComponent(keyword)}`
    }
  }
})
