const app = getApp()
const db = wx.cloud.database()
const { createProductSummary } = require('../../common/mall-sku')

Page({
  data: {
    statusBarHeight: 20,
    workshopId: '',
    workshopInfo: null,
    products: [],
    isOwner: false,
    loading: true
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
        this.setData({
          workshopId: userInfo.workshop_id
        })
        this.loadWorkshopData()
      } else {
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
      }
    } catch (err) {
      console.error('加载用户工坊失败:', err)
      this.setData({ loading: false })
    }
  },

  async loadWorkshopData() {
    try {
      this.setData({ loading: true })

      const workshopRes = await db.collection('shopping_workshops')
        .doc(this.data.workshopId)
        .get()

      if (!workshopRes.data) {
        this.setData({
          loading: false,
          workshopInfo: null
        })
        return
      }

      const workshopInfo = workshopRes.data
      const isOwner = Boolean(app.globalData.openid && app.globalData.openid === workshopInfo.owner_id)

      if (workshopInfo.rating) {
        workshopInfo.rating = Number(workshopInfo.rating).toFixed(1)
      }

      this.setData({
        workshopInfo,
        isOwner
      })

      this.loadProducts()
    } catch (err) {
      console.error('加载工坊数据失败:', err)
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
      const _ = db.command
      const whereCondition = { workshop_id: workshopId }

      if (!isOwner) {
        whereCondition.status = 1
        whereCondition.total_stock = _.gt(0)
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
          priceDisplay: `${summary.priceDisplay}${summary.priceSuffix}`
        }
      })

      this.setData({
        products,
        loading: false
      })
    } catch (err) {
      console.error('加载商品列表失败:', err)
      this.setData({ loading: false })
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
        title: '仅主理人可发布商品',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onShow() {
    if (this.data.workshopId && this.data.workshopInfo) {
      this.loadWorkshopData()
    }
  },

  onPullDownRefresh() {
    if (this.data.workshopId) {
      this.loadWorkshopData().then(() => {
        wx.stopPullDownRefresh()
      })
    } else {
      wx.stopPullDownRefresh()
    }
  }
})
