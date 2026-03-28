const app = getApp()
const db = wx.cloud.database()
const { formatPrice, createProductSelectionView } = require('../../common/mall-sku')

const LOGISTICS_POSTAGE_TEXT = {
  free: '快递包邮',
  pay_on_delivery: '邮费到付'
}

function normalizeLogistics(logistics, origin) {
  const method = logistics && logistics.method ? logistics.method : 'express'
  const postage = logistics && logistics.postage ? logistics.postage : 'free'
  const shipFrom = (logistics && logistics.ship_from ? logistics.ship_from : origin || '湖南·长沙').trim()
  return {
    method,
    postage,
    ship_from: shipFrom,
    postageDisplay: LOGISTICS_POSTAGE_TEXT[postage] || '快递包邮',
    isPayOnDelivery: postage === 'pay_on_delivery'
  }
}

Page({
  data: {
    loading: true,
    product: null,
    quantity: 1,
    address: null,
    totalFen: 0,
    totalDisplay: '0.00',
    freightDisplay: '0.00',
    showPayOnDeliveryNote: false,
    submitting: false,
    showPayKeyboard: false,
    paying: false,
    pendingOrderId: '',
    selectedSkuId: ''
  },

  onLoad(options) {
    const quantity = Math.max(1, Number(options.quantity) || 1)
    const skuId = options.skuId || ''

    this.setData({
      quantity,
      selectedSkuId: skuId
    })

    if (options.productId && skuId) {
      this._productId = options.productId
      this.loadProduct(options.productId, skuId)
      this.loadDefaultAddress()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  async loadProduct(productId, skuId) {
    try {
      const res = await db.collection('shopping_products').doc(productId).get()
      if (!res.data) throw new Error('商品不存在')

      const product = createProductSelectionView(res.data, skuId)
      const selectedSku = product.selectedSku

      if (!selectedSku) {
        throw new Error('所选款式不存在')
      }
      if (product.status !== 1 || product.is_on_sale === false) {
        throw new Error('商品已下架')
      }
      if (!product.total_stock || product.total_stock < this.data.quantity) {
        throw new Error('商品库存不足')
      }
      if (selectedSku.stock < this.data.quantity) {
        throw new Error('该款式库存不足')
      }

      const totalFen = selectedSku.price * this.data.quantity
      const logistics = normalizeLogistics(product.logistics, product.origin || '')

      this.setData({
        product: {
          ...product,
          logistics,
          skuImage: product.displayImage || product.cover_img,
          skuName: selectedSku.sku_name,
          priceDisplay: formatPrice(selectedSku.price),
          originalPriceDisplay: selectedSku.original_price > selectedSku.price ? formatPrice(selectedSku.original_price) : ''
        },
        totalFen,
        totalDisplay: formatPrice(totalFen),
        freightDisplay: '0.00',
        showPayOnDeliveryNote: logistics.isPayOnDelivery,
        loading: false
      })
    } catch (err) {
      console.error('加载商品失败:', err)
      wx.showToast({ title: err.message || '商品加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  async loadDefaultAddress() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      let res = await db.collection('shopping_addresses')
        .where({ _openid: openid, is_default: true })
        .limit(1)
        .get()

      if (!res.data || res.data.length === 0) {
        res = await db.collection('shopping_addresses')
          .where({ _openid: openid })
          .orderBy('update_time', 'desc')
          .limit(1)
          .get()
      }

      if (res.data && res.data.length > 0) {
        const addr = res.data[0]
        this.setData({
          address: {
            _id: addr._id,
            userName: addr.name,
            telNumber: addr.phone,
            provinceName: addr.province,
            cityName: addr.city,
            countyName: addr.district,
            detailInfo: addr.detail
          }
        })
      }
    } catch (err) {
      console.warn('加载默认地址失败:', err)
    }
  },

  chooseAddress() {
    wx.navigateTo({ url: '/pages/address/list?select=1' })
  },

  async submitOrder() {
    if (!app.checkLogin()) {
      app.requireLogin()
      return
    }

    const { address, product, quantity, submitting } = this.data
    if (submitting) return

    if (!address) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' })
      return
    }
    if (!product || !product.selectedSku) {
      wx.showToast({ title: '商品信息异常', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'create_order',
        data: {
          product_id: product._id,
          sku_id: product.selectedSku.sku_id,
          quantity,
          delivery_address: address
        }
      })

      wx.hideLoading()

      const result = res.result
      if (result && result.success) {
        this.setData({
          submitting: false,
          pendingOrderId: result.order_id,
          totalDisplay: formatPrice(result.total_price),
          showPayKeyboard: true
        })
      } else {
        this.setData({ submitting: false })
        wx.showToast({ title: result.message || '下单失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      console.error('下单失败:', err)
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    }
  },

  async onPayConfirm(e) {
    const { password } = e.detail
    const { pendingOrderId } = this.data
    if (!pendingOrderId) return

    this.setData({ paying: true })
    const keyboard = this.selectComponent('#payKeyboard')

    try {
      const res = await wx.cloud.callFunction({
        name: 'process_payment',
        data: {
          order_id: pendingOrderId,
          pay_password: password
        }
      })

      const result = res.result
      if (result && result.success) {
        this.setData({ showPayKeyboard: false, paying: false, pendingOrderId: '' })
        wx.showToast({ title: '支付成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/order/list?status=20' })
        }, 1200)
      } else {
        this.setData({ paying: false })
        if (keyboard) keyboard.setError(result.message || '支付失败，请重试')
      }
    } catch (err) {
      this.setData({ paying: false })
      console.error('支付调用失败:', err)
      if (keyboard) keyboard.setError('网络异常，请稍后重试')
    }
  },

  async onPayKeyboardClose() {
    const { pendingOrderId } = this.data
    this.setData({ showPayKeyboard: false })

    if (!pendingOrderId) return
    this.setData({ pendingOrderId: '' })

    wx.cloud.callFunction({
      name: 'cancel_order',
      data: {
        order_id: pendingOrderId,
        reason: '用户取消支付'
      }
    }).catch((err) => {
      console.warn('取消订单失败（定时器会兜底）:', err)
    })
  }
})
