const app = getApp()
const db = wx.cloud.database()

function formatPrice(fen) {
  if (fen !== 0 && !fen) return '0'
  const yuan = Number(fen) / 100
  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
}

function normalizeProduct(item) {
  const stock = Number(item.stock) || 0
  const sales = Number(item.sales) || 0
  const views = Number(item.view_count) || 0
  const isOnSale = item.is_on_sale !== false
  const isSoldOut = stock <= 0
  const statusKey = isSoldOut ? 'sold_out' : (isOnSale ? 'selling' : 'warehouse')

  let badgeText = ''
  if (isSoldOut) {
    badgeText = '已售罄'
  } else if (!isOnSale) {
    badgeText = '已下架'
  } else if (stock <= 5) {
    badgeText = '库存不足'
  }

  return {
    ...item,
    stock,
    sales,
    views,
    isOnSale,
    isSoldOut,
    statusKey,
    badgeText,
    priceDisplay: formatPrice(item.price),
    canDelete: !isOnSale && sales === 0
  }
}

Page({
  data: {
    workshopId: '',
    workshopInfo: null,
    loading: true,
    activeTab: 'selling',
    products: [],
    filteredProducts: [],
    stats: {
      selling: 0,
      soldOut: 0,
      warehouse: 0
    }
  },

  onLoad(options) {
    const workshopId = options.id || (app.globalData.userInfo && app.globalData.userInfo.workshop_id) || ''
    if (!workshopId) {
      wx.showToast({ title: '工坊信息异常', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    this.setData({ workshopId })
    this.loadPageData()
  },

  onShow() {
    if (this.data.workshopId) {
      this.loadPageData()
    }
  },

  onPullDownRefresh() {
    this.loadPageData().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadPageData() {
    if (!this.data.workshopId) return

    this.setData({ loading: true })
    try {
      const [workshopRes, productRes] = await Promise.all([
        db.collection('shopping_workshops').doc(this.data.workshopId).get(),
        db.collection('shopping_products')
          .where({ workshop_id: this.data.workshopId })
          .orderBy('update_time', 'desc')
          .get()
      ])

      const products = (productRes.data || []).map(normalizeProduct)
      const stats = {
        selling: products.filter((item) => item.statusKey === 'selling').length,
        soldOut: products.filter((item) => item.statusKey === 'sold_out').length,
        warehouse: products.filter((item) => item.statusKey === 'warehouse').length
      }

      this.setData({
        workshopInfo: workshopRes.data || null,
        products,
        stats,
        loading: false
      })
      this.applyFilter()
    } catch (err) {
      console.error('加载商品管理页失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '商品加载失败', icon: 'none' })
    }
  },

  applyFilter() {
    const { products, activeTab } = this.data
    const filteredProducts = products.filter((item) => {
      if (activeTab === 'selling') return item.statusKey === 'selling'
      if (activeTab === 'sold_out') return item.statusKey === 'sold_out'
      return item.statusKey === 'warehouse'
    })

    this.setData({ filteredProducts })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.applyFilter()
  },

  getProductById(productId) {
    return this.data.products.find((item) => item._id === productId)
  },

  goToPublish() {
    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  editProduct(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    wx.navigateTo({
      url: `/pages/product/publish?product_id=${id}`
    })
  },

  async callManageProduct(data, loadingTitle = '处理中...') {
    wx.showLoading({ title: loadingTitle, mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_shopping_product',
        data
      })
      wx.hideLoading()
      return res.result || { success: false, message: '操作失败' }
    } catch (err) {
      wx.hideLoading()
      console.error('商品管理操作失败:', err)
      return { success: false, message: '网络异常，请稍后重试' }
    }
  },

  async toggleSale(e) {
    const product = this.getProductById(e.currentTarget.dataset.id)
    if (!product) return

    if (!product.isOnSale && product.stock <= 0) {
      wx.showToast({ title: '请先补充库存后再上架', icon: 'none' })
      return
    }

    const result = await this.callManageProduct({
      action: 'toggle_sale',
      product_id: product._id,
      is_on_sale: !product.isOnSale
    }, product.isOnSale ? '下架中...' : '上架中...')

    if (!result.success) {
      wx.showToast({ title: result.message || '操作失败', icon: 'none' })
      return
    }

    wx.showToast({ title: result.message, icon: 'success' })
    this.loadPageData()
  },

  quickEditStock(e) {
    const product = this.getProductById(e.currentTarget.dataset.id)
    if (!product) return

    wx.showModal({
      title: '修改库存',
      editable: true,
      placeholderText: '请输入库存数量',
      content: String(product.stock),
      confirmColor: '#9f2f2a',
      success: async (res) => {
        if (!res.confirm) return

        const stock = Number((res.content || '').trim())
        if (!Number.isInteger(stock) || stock < 0) {
          wx.showToast({ title: '请输入大于等于 0 的整数', icon: 'none' })
          return
        }

        const result = await this.callManageProduct({
          action: 'update_stock',
          product_id: product._id,
          stock
        }, '更新库存中...')

        if (!result.success) {
          wx.showToast({ title: result.message || '库存更新失败', icon: 'none' })
          return
        }

        wx.showToast({ title: result.message, icon: 'success' })
        this.loadPageData()
      }
    })
  },

  deleteProduct(e) {
    const product = this.getProductById(e.currentTarget.dataset.id)
    if (!product) return

    wx.showModal({
      title: '删除商品',
      content: '删除后将同步清理商品图片，且无法恢复，确认继续吗？',
      confirmColor: '#c53b32',
      success: async (res) => {
        if (!res.confirm) return

        const result = await this.callManageProduct({
          action: 'delete',
          product_id: product._id
        }, '删除中...')

        if (!result.success) {
          wx.showToast({ title: result.message || '删除失败', icon: 'none' })
          return
        }

        wx.showToast({ title: '删除成功', icon: 'success' })
        this.loadPageData()
      }
    })
  }
})
