const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')

Page({
  data: {
    categories: [
      { id: 'all', name: '全部' },
      { id: '手工体验', name: '手工体验' },
      { id: '非遗摆件', name: '非遗摆件' },
      { id: '地道风物', name: '地道风物' },
      { id: '文房雅器', name: '文房雅器' },
      { id: '服饰配件', name: '服饰配件' },
      { id: '家居装饰', name: '家居装饰' },
      { id: '文创礼品', name: '文创礼品' },
      { id: '其他', name: '其他' }
    ],
    activeIndex: 0,
    activeCategory: 'all',
    products: [],
    loading: true,
    page: 0,
    pageSize: 20,
    noMore: false
  },

  onLoad() {
    this.loadProducts(true)
  },

  async loadProducts(refresh = false) {
    if (refresh) {
      this.setData({
        products: [],
        page: 0,
        noMore: false,
        loading: true
      })
    }

    try {
      const { activeCategory, page, pageSize } = this.data
      const _ = db.command
      const whereCondition = {
        status: 1,
        total_stock: _.gt(0),
        is_on_sale: true
      }

      if (activeCategory !== 'all') {
        whereCondition.category = activeCategory
      }

      const res = await db.collection('shopping_products')
        .where(whereCondition)
        .skip(page * pageSize)
        .limit(pageSize)
        .orderBy('sales', 'desc')
        .get()

      const newProducts = (res.data || []).map((item) => {
        const summary = createProductSummary(item)
        return {
          ...summary,
          priceDisplay: `${summary.priceDisplay}${summary.priceSuffix}`
        }
      })

      if (newProducts.length < pageSize) {
        this.setData({ noMore: true })
      }

      this.setData({
        products: refresh ? newProducts : [...this.data.products, ...newProducts],
        page: page + 1,
        loading: false
      })
    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({ loading: false })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  onCategoryChange(e) {
    const index = e.detail
    const category = this.data.categories[index]
    this.setData({
      activeIndex: index,
      activeCategory: category.id
    })
    this.loadProducts(true)
  },

  goToDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  onReachBottom() {
    if (!this.data.noMore && !this.data.loading) {
      this.loadProducts(false)
    }
  },

  onShareAppMessage() {
    return {
      title: '湘韵遗珍 · 非遗分类',
      path: '/pages/mall/category'
    }
  }
})
