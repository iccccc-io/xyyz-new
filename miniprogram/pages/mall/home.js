// pages/mall/home.js
const db = wx.cloud.database()

/**
 * 格式化价格（处理大数字）
 * 数据库存的是元（整数），直接格式化显示
 * 层级：万 → 千万 → 亿 → 百亿 → 万亿
 * @param {number} price - 价格（单位：元）
 * @returns {string} 格式化后的价格字符串
 */
function formatPrice(price) {
  if (!price && price !== 0) return '0'
  
  // 确保是数字
  price = Number(price)
  if (isNaN(price) || !isFinite(price)) return '0'
  
  // >= 1万亿 (10^12)，显示为"x万亿"
  if (price >= 1000000000000) {
    const wanYi = price / 1000000000000
    if (wanYi >= 10) {
      return Math.floor(wanYi) + '万亿'
    }
    return wanYi.toFixed(1).replace(/\.0$/, '') + '万亿'
  }
  
  // >= 100亿 (10^10)，显示为"xxx亿"
  if (price >= 10000000000) {
    const yi = price / 100000000
    return Math.floor(yi) + '亿'
  }
  
  // >= 1亿 (10^8)，显示为"x.x亿"
  if (price >= 100000000) {
    const yi = price / 100000000
    return yi.toFixed(1).replace(/\.0$/, '') + '亿'
  }
  
  // >= 1000万 (10^7)，显示为"xxxx万"
  if (price >= 10000000) {
    const wan = price / 10000
    return Math.floor(wan) + '万'
  }
  
  // >= 1万 (10^4)，显示为"x.x万"
  if (price >= 10000) {
    const wan = price / 10000
    return wan.toFixed(1).replace(/\.0$/, '') + '万'
  }
  
  // 小于1万，正常显示
  if (Number.isInteger(price)) {
    return price.toString()
  }
  return price.toFixed(2).replace(/\.?0+$/, '')
}

/**
 * 截断文本
 * @param {string} text - 原始文本
 * @param {number} maxLen - 最大长度
 * @returns {string} 截断后的文本
 */
function truncateText(text, maxLen) {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    statusBarHeight: 20,
    searchValue: '',
    // 每日推荐商品
    featuredProduct: null,
    // 快捷入口列表（跳转用，不再用于筛选）
    quickEntries: [
      { id: 'category', name: '全部分类', icon: 'apps-o', type: 'category' },
      { id: '手工体验', name: '手工体验', icon: 'gift-o', type: 'topic' },
      { id: '非遗摆件', name: '非遗摆件', icon: 'gem-o', type: 'topic' },
      { id: '地道风物', name: '地道风物', icon: 'shop-o', type: 'topic' },
      { id: '文房雅器', name: '文房雅器', icon: 'edit', type: 'topic' }
    ],
    // 非遗工坊直供专区
    workshops: [],
    // 商品列表 - 双列瀑布流
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
    // 获取状态栏高度
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20
    })
    
    this.loadFeaturedProduct()
    this.loadWorkshops()
    this.loadProducts(true)
  },

  /**
   * 加载每日推荐商品
   */
  async loadFeaturedProduct() {
    try {
      const _ = db.command
      const res = await db.collection('shopping_products')
        .where({
          status: 1, // 已上架
          stock: _.gt(0) // 有库存
        })
        .orderBy('sales', 'desc')
        .limit(1)
        .get()
      
      if (res.data.length > 0) {
        const item = res.data[0]
        this.setData({
          featuredProduct: {
            ...item,
            priceDisplay: formatPrice(item.price),
            titleDisplay: truncateText(item.title, 15),
            originDisplay: truncateText(item.origin || '湖南', 6)
          }
        })
      }
    } catch (err) {
      console.error('加载推荐商品失败:', err)
    }
  },

  /**
   * 加载非遗工坊直供专区
   * 从 shopping_workshops 表获取工坊信息
   */
  async loadWorkshops() {
    try {
      // 查询工坊表，按销量排序
      const workshopsRes = await db.collection('shopping_workshops')
        .orderBy('total_sales', 'desc')
        .limit(10)
        .get()
      
      const workshops = []
      
      // 为每个工坊查询一个代表商品（销量最高的商品作为封面）
      for (const workshop of workshopsRes.data) {
        const productRes = await db.collection('shopping_products')
          .where({
            workshop_id: workshop._id,
            status: 1
          })
          .orderBy('sales', 'desc')
          .limit(1)
          .get()
        
        const product = productRes.data[0]
        workshops.push({
          id: workshop._id,
          name: truncateText(workshop.name, 8),
          origin: truncateText(workshop.ich_category || '湖南', 6),
          ich_category: workshop.ich_category,
          product: product ? {
            ...product,
            priceDisplay: formatPrice(product.price),
            titleDisplay: truncateText(product.title, 10)
          } : null
        })
      }
      
      this.setData({
        workshops: workshops
      })
    } catch (err) {
      console.error('加载工坊数据失败:', err)
    }
  },

  /**
   * 加载商品列表（首页展示全部商品，不再按分类筛选）
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
      const { page, pageSize, searchValue } = this.data
      const _ = db.command
      
      let query = db.collection('shopping_products')
      
      // 基础过滤：只显示已上架且有库存的商品
      let whereCondition = {
        status: 1, // 已上架
        stock: _.gt(0) // 有库存
      }
      
      // 搜索筛选
      if (searchValue) {
        whereCondition.title = db.RegExp({
          regexp: searchValue,
          options: 'i'
        })
      }
      
      const res = await query
        .where(whereCondition)
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()
      
      const products = res.data
      
      if (products.length < pageSize) {
        this.setData({ noMore: true })
      }

      // 格式化商品数据
      const formattedProducts = products.map(item => ({
        ...item,
        // 价格格式化（直接格式化，大数字转为万/亿）
        priceDisplay: formatPrice(item.price),
        originalPriceDisplay: item.original_price ? formatPrice(item.original_price) : '',
        // 文字截断
        titleDisplay: truncateText(item.title, 20),
        originDisplay: truncateText(item.origin || '湖南', 8)
      }))

      // 瀑布流分配 - 简单的左右交替分配
      const { leftColumn, rightColumn } = this.data
      let left = refresh ? [] : [...leftColumn]
      let right = refresh ? [] : [...rightColumn]
      
      formattedProducts.forEach((item, index) => {
        // 跳过推荐商品（如果在第一页）
        if (refresh && this.data.featuredProduct && item._id === this.data.featuredProduct._id) {
          return
        }
        
        if ((left.length <= right.length)) {
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
   * 搜索输入
   */
  onSearchInput(e) {
    this.setData({
      searchValue: e.detail
    })
  },

  /**
   * 搜索确认
   */
  onSearch() {
    this.loadProducts(true)
  },

  /**
   * 清空搜索
   */
  onSearchClear() {
    this.setData({
      searchValue: ''
    })
    this.loadProducts(true)
  },

  /**
   * 快捷入口点击 - 跳转到对应页面
   */
  onEntryTap(e) {
    const { id, type } = e.currentTarget.dataset
    
    if (type === 'category') {
      // 跳转到全部分类页
      wx.navigateTo({
        url: '/pages/mall/category'
      })
    } else if (type === 'topic') {
      // 跳转到专题页，传递关键字
      wx.navigateTo({
        url: `/pages/mall/topic?keyword=${encodeURIComponent(id)}`
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
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 更新自定义 tabBar 选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(2)
    }
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
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    this.loadProducts(false)
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '湘韵遗珍 · 文创好物',
      path: '/pages/mall/home'
    }
  }
})

