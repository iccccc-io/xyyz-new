// pages/mall/topic.js
const db = wx.cloud.database()

/**
 * 将价格（分）格式化为可读的元字符串
 * @param {number} fen - 价格（单位：分）
 * @returns {string}
 */
function formatPrice(fen) {
  if (!fen && fen !== 0) return '0.00'
  const yuan = fen / 100
  if (yuan >= 100000000) return (yuan / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (yuan >= 10000) return (yuan / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 专题关键字
    keyword: '',
    // 专题配置
    topicConfig: {
      '手工体验': {
        title: '手工体验',
        subtitle: '亲手触摸非遗的温度',
        icon: 'gift-o',
        color: '#E8846B'
      },
      '非遗摆件': {
        title: '非遗摆件',
        subtitle: '匠心独运的艺术珍品',
        icon: 'gem-o',
        color: '#7B68A6'
      },
      '地道风物': {
        title: '地道风物',
        subtitle: '来自湖湘的地道好物',
        icon: 'shop-o',
        color: '#5B9A8B'
      },
      '文房雅器': {
        title: '文房雅器',
        subtitle: '书房案头的风雅之选',
        icon: 'edit',
        color: '#6B5B4F'
      }
    },
    currentTopic: null,
    // 商品列表 - 瀑布流
    leftColumn: [],
    rightColumn: [],
    // 加载状态
    loading: true,
    loadingMore: false,
    noMore: false,
    // 分页
    page: 0,
    pageSize: 10
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const keyword = decodeURIComponent(options.keyword || '')
    
    if (!keyword) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
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
      keyword: keyword,
      currentTopic: topicConfig
    })

    // 设置导航栏标题
    wx.setNavigationBarTitle({
      title: topicConfig.title
    })

    this.loadProducts(true)
  },

  /**
   * 加载商品列表（按 tags 筛选）
   */
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
          stock: _.gt(0),
          is_on_sale: true
        })
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const products = res.data.map(item => ({
        ...item,
        priceDisplay: formatPrice(item.price),
        originalPriceDisplay: item.original_price ? formatPrice(item.original_price) : ''
      }))

      if (products.length < pageSize) {
        this.setData({ noMore: true })
      }

      // 瀑布流分配
      const { leftColumn, rightColumn } = this.data
      let left = refresh ? [] : [...leftColumn]
      let right = refresh ? [] : [...rightColumn]

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

  /**
   * 跳转商品详情
   */
  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    this.loadProducts(false)
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.loadProducts(true).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    const { keyword, currentTopic } = this.data
    return {
      title: `湘韵遗珍 · ${currentTopic ? currentTopic.title : keyword}`,
      path: `/pages/mall/topic?keyword=${encodeURIComponent(keyword)}`
    }
  }
})

