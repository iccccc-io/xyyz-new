/**
 * pages/mall/checkout.js
 * 下单确认页
 *
 * 完整流程：
 * 1. 展示商品信息 + 默认地址
 * 2. 用户选择/修改收货地址
 * 3. 点击「提交订单」→ 调用 create_order 云函数（库存扣减+订单创建）
 * 4. 弹出支付键盘 → 输入密码 → 调用 process_payment 云函数
 * 5. 支付成功 → 跳转订单列表；取消 → 调用 cancel_order 云函数
 *
 * --- 上线切换说明 ---
 * 步骤 4 替换为：
 *   create_order 返回 prepay_id → wx.requestPayment 拉起微信支付
 *   process_payment 改为微信支付回调通知处理
 */
const app = getApp()
const db = wx.cloud.database()

function formatPrice(fen) {
  if (!fen && fen !== 0) return '0.00'
  const yuan = fen / 100
  if (yuan >= 10000) return (yuan / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
}

Page({
  data: {
    loading: true,
    product: null,
    quantity: 1,
    address: null,
    totalFen: 0,
    totalDisplay: '0.00',
    submitting: false,
    showPayKeyboard: false,
    paying: false,
    pendingOrderId: ''
  },

  onLoad(options) {
    const quantity = Math.max(1, Number(options.quantity) || 1)
    this.setData({ quantity })

    if (options.productId) {
      this._productId = options.productId
      this.loadProduct(options.productId)
      this.loadDefaultAddress()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  // ===================================================================
  //  数据加载
  // ===================================================================

  async loadProduct(productId) {
    try {
      const res = await db.collection('shopping_products').doc(productId).get()
      if (!res.data) throw new Error('商品不存在')

      const product = res.data
      const { quantity } = this.data
      const totalFen = product.price * quantity

      this.setData({
        product: {
          ...product,
          priceDisplay: formatPrice(product.price)
        },
        totalFen,
        totalDisplay: formatPrice(totalFen),
        loading: false
      })
    } catch (err) {
      console.error('加载商品失败:', err)
      wx.showToast({ title: '商品加载失败', icon: 'none' })
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

  // ===================================================================
  //  地址选择（跳转到地址管理页，选择模式）
  // ===================================================================

  chooseAddress() {
    wx.navigateTo({ url: '/pages/address/list?select=1' })
  },

  // ===================================================================
  //  提交订单 → 调用 create_order 云函数
  // ===================================================================

  async submitOrder() {
    if (!app.checkLogin()) { app.requireLogin(); return }

    const { address, product, quantity, submitting } = this.data
    if (submitting) return

    if (!address) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' })
      return
    }
    if (!product) {
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
          quantity: quantity,
          delivery_address: address
        }
      })

      wx.hideLoading()

      const result = res.result
      if (result && result.success) {
        const totalDisplay = formatPrice(result.total_price)
        this.setData({
          submitting: false,
          pendingOrderId: result.order_id,
          totalDisplay,
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

  // ===================================================================
  //  支付键盘：确认支付 → 调用 process_payment 云函数
  // ===================================================================

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

  // ===================================================================
  //  支付键盘：关闭/取消 → 调用 cancel_order 云函数
  // ===================================================================

  async onPayKeyboardClose() {
    const { pendingOrderId } = this.data
    this.setData({ showPayKeyboard: false })

    if (!pendingOrderId) return
    this.setData({ pendingOrderId: '' })

    // 异步取消订单（不阻塞 UI）
    wx.cloud.callFunction({
      name: 'cancel_order',
      data: {
        order_id: pendingOrderId,
        reason: '用户取消支付'
      }
    }).catch(e => console.warn('取消订单失败（定时器会兜底）:', e))
  }
})
