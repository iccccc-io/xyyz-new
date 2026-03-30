const app = getApp()
const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')

function createQuickSkuDraft(sku, existingDraft = {}) {
  const currentStock = Number(sku.stock || 0)
  const stockDelta = Number(existingDraft.stock_delta)

  return {
    sku_id: sku.sku_id,
    sku_name: sku.sku_name,
    price: typeof existingDraft.price !== 'undefined'
      ? String(existingDraft.price)
      : String((Number(sku.price || 0) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'),
    original_price: typeof existingDraft.original_price !== 'undefined'
      ? String(existingDraft.original_price)
      : String((Number((sku.original_price || sku.price || 0)) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'),
    current_stock: currentStock,
    stock_delta: Number.isFinite(stockDelta) ? stockDelta : 0,
    next_stock: Math.max(0, currentStock + (Number.isFinite(stockDelta) ? stockDelta : 0))
  }
}

function normalizeProduct(item) {
  const summary = createProductSummary(item)
  const totalStock = Number(summary.total_stock) || 0
  const sales = Number(summary.sales) || 0
  const views = Number(summary.view_count) || 0
  const isOnSale = summary.is_on_sale !== false
  const isSoldOut = totalStock <= 0
  const statusKey = isSoldOut ? 'sold_out' : (isOnSale ? 'selling' : 'warehouse')

  let badgeText = ''
  if (isSoldOut) {
    badgeText = '已售罄'
  } else if (!isOnSale) {
    badgeText = '已下架'
  } else if (totalStock <= 5) {
    badgeText = '库存紧张'
  }

  const existingDrafts = Array.isArray(item.quickSkuDrafts) ? item.quickSkuDrafts : []
  const canReuseDrafts = existingDrafts.length === summary.skus.length
    && existingDrafts.every((draft, index) => draft && draft.sku_id === summary.skus[index].sku_id)
  const quickSkuDrafts = summary.skus.map((sku, index) => createQuickSkuDraft(
    sku,
    canReuseDrafts ? existingDrafts[index] : {}
  ))

  return {
    ...summary,
    totalStock,
    sales,
    views,
    isOnSale,
    isSoldOut,
    statusKey,
    badgeText,
    canDelete: !isOnSale && sales === 0,
    quickSkuDrafts,
    skuExpanded: !!item.skuExpanded,
    skuSaving: !!item.skuSaving
  }
}

function normalizePriceInput(value) {
  return String(value || '').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
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

  updateProductInState(productId, updater) {
    const apply = (list) => list.map((item) => {
      if (item._id !== productId) return item
      const updated = updater(item)
      return normalizeProduct({
        ...item,
        ...updated,
        skus: updated.skus || item.skus
      })
    })

    const nextProducts = apply(this.data.products)
    const nextFiltered = apply(this.data.filteredProducts)
    const stats = {
      selling: nextProducts.filter((item) => item.statusKey === 'selling').length,
      soldOut: nextProducts.filter((item) => item.statusKey === 'sold_out').length,
      warehouse: nextProducts.filter((item) => item.statusKey === 'warehouse').length
    }

    this.setData({
      products: nextProducts,
      filteredProducts: nextFiltered,
      stats
    })
  },

  toggleSkuDrawer(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return

    const nextProducts = this.data.products.map((item) => ({
      ...item,
      skuExpanded: item._id === id ? !item.skuExpanded : false
    }))
    const nextFiltered = this.data.filteredProducts.map((item) => ({
      ...item,
      skuExpanded: item._id === id ? !item.skuExpanded : false
    }))

    this.setData({
      products: nextProducts,
      filteredProducts: nextFiltered
    })
  },

  onQuickSkuInput(e) {
    const { id, skuIndex, field } = e.currentTarget.dataset
    if (!id || typeof field !== 'string') return
    const index = Number(skuIndex)
    if (Number.isNaN(index)) return

    let value = e.detail && typeof e.detail.value !== 'undefined' ? e.detail.value : ''
    if (field === 'price' || field === 'original_price') {
      value = normalizePriceInput(value)
    } else if (field === 'stock') {
      value = String(value || '').replace(/[^\d]/g, '')
    }

    this.updateProductInState(id, (product) => {
      const drafts = (product.quickSkuDrafts || []).map((item, draftIndex) => (
        draftIndex === index ? { ...item, [field]: value } : item
      ))
      return { quickSkuDrafts: drafts, skuExpanded: true }
    })
  },

  onQuickStockAdjust(e) {
    const { id, skuIndex, step } = e.currentTarget.dataset
    if (!id) return
    const index = Number(skuIndex)
    const deltaStep = Number(step)
    if (Number.isNaN(index) || !Number.isFinite(deltaStep) || deltaStep === 0) return

    this.updateProductInState(id, (product) => {
      const drafts = (product.quickSkuDrafts || []).map((item, draftIndex) => {
        if (draftIndex !== index) return item
        const currentStock = Number(item.current_stock || 0)
        const currentDelta = Number(item.stock_delta || 0)
        const nextDelta = Math.max(-currentStock, currentDelta + deltaStep)
        return {
          ...item,
          stock_delta: nextDelta,
          next_stock: currentStock + nextDelta
        }
      })
      return { quickSkuDrafts: drafts, skuExpanded: true }
    })
  },

  onQuickStockDeltaInput(e) {
    const { id, skuIndex } = e.currentTarget.dataset
    if (!id) return
    const index = Number(skuIndex)
    if (Number.isNaN(index)) return

    const rawValue = e.detail && typeof e.detail.value !== 'undefined' ? String(e.detail.value) : ''
    const normalizedValue = rawValue.replace(/[^\d-]/g, '')

    this.updateProductInState(id, (product) => {
      const drafts = (product.quickSkuDrafts || []).map((item, draftIndex) => {
        if (draftIndex !== index) return item
        const currentStock = Number(item.current_stock || 0)
        const parsedDelta = normalizedValue === '' || normalizedValue === '-' ? 0 : Number(normalizedValue)
        const nextDelta = Number.isFinite(parsedDelta) ? Math.max(-currentStock, parsedDelta) : 0
        return {
          ...item,
          stock_delta: nextDelta,
          next_stock: currentStock + nextDelta
        }
      })
      return { quickSkuDrafts: drafts, skuExpanded: true }
    })
  },

  async saveQuickSkuChanges(e) {
    const { id } = e.currentTarget.dataset
    const product = this.getProductById(id)
    if (!product || product.skuSaving) return

    const drafts = Array.isArray(product.quickSkuDrafts) ? product.quickSkuDrafts : []
    if (!drafts.length) return

    const payloadSkus = []
    for (const sku of drafts) {
      const price = Number(sku.price)
      const originalPrice = sku.original_price === '' ? price : Number(sku.original_price)
      const stock = Number(sku.current_stock || 0) + Number(sku.stock_delta || 0)

      if (!price || price <= 0) {
        wx.showToast({ title: `请检查 ${sku.sku_name} 的现价`, icon: 'none' })
        return
      }
      if (!originalPrice || originalPrice < price) {
        wx.showToast({ title: `请检查 ${sku.sku_name} 的原价`, icon: 'none' })
        return
      }
      if (!Number.isInteger(stock) || stock < 0) {
        wx.showToast({ title: `请检查 ${sku.sku_name} 的库存`, icon: 'none' })
        return
      }

      payloadSkus.push({
        sku_id: sku.sku_id,
        price: Math.round(price * 100),
        original_price: Math.round(originalPrice * 100),
        stock
      })
    }

    this.updateProductInState(id, () => ({ skuSaving: true, skuExpanded: true }))

    const result = await this.callManageProduct({
      action: 'quick_update_skus',
      product_id: id,
      payload: {
        skus: payloadSkus
      }
    }, '保存中...')

    if (!result.success) {
      this.updateProductInState(id, () => ({ skuSaving: false, skuExpanded: true }))
      wx.showToast({ title: result.message || '保存失败', icon: 'none' })
      return
    }

    wx.showToast({ title: 'SKU 已更新', icon: 'success' })
    this.loadPageData()
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

    if (!product.isOnSale && product.totalStock <= 0) {
      wx.showToast({ title: '请先补充 SKU 库存后再上架', icon: 'none' })
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
