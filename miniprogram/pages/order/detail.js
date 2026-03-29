// pages/order/detail.js
const app = getApp()
const db = wx.cloud.database()

const STATUS_MAP = {
  10: { text: '待付款',  icon: 'clock-o',    desc: '请尽快完成支付，超时将自动取消' },
  20: { text: '待发货',  icon: 'gift-o',     desc: '订单已支付，等待卖家发货' },
  30: { text: '待收货',  icon: 'logistics',  desc: '快递已发出，请注意查收' },
  40: { text: '交易完成', icon: 'passed',    desc: '7天售后窗口内可申请退货退款' },
  50: { text: '已取消',  icon: 'close',      desc: '订单已取消' },
  60: { text: '售后处理', icon: 'service-o', desc: '加载售后详情中...' }
}


function formatFen(fen) {
  if (!fen && fen !== 0) return '0.00'
  return (fen / 100).toFixed(2)
}

function formatTime(val) {
  if (!val) return ''
  const d = val instanceof Date ? val : new Date(val)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getReviewState(order) {
  const reviewStatus = Number(order && order.review_status) === 1 ? 1 : 0
  const reviewId = typeof (order && order.review_id) === 'string' ? order.review_id : ''
  const canReview = Number(order && order.status) === 40 && order && order.has_aftersale !== true

  return {
    reviewStatus,
    reviewId,
    canReview,
    reviewButtonText: reviewStatus === 1 ? '我的评价' : '去评价'
  }
}

Page({
  data: {
    loading: true,
    order: null,
    // 支付倒计时（秒）
    countdown: 0,
    countdownDisplay: '',
    // 续付键盘
    showPayKeyboard: false,
    paying: false,
    // 售后相关
    canApplyAftersale: false,
    aftersaleDeadlineDisplay: '',
    activeAftersaleId: '',
    aftersaleLog: null
  },

  _timer: null,

  onLoad(options) {
    if (options.id) {
      this.loadOrder(options.id)
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  onUnload() {
    this._clearTimer()
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  async loadOrder(id) {
    try {
      this.setData({
        loading: true,
        canApplyAftersale: false,
        aftersaleDeadlineDisplay: '',
        activeAftersaleId: '',
        aftersaleLog: null
      })
      const res = await db.collection('shopping_orders').doc(id).get()
      const raw = res.data
      let info = STATUS_MAP[raw.status] || { text: '未知', icon: 'question-o', desc: '' }

      if (raw.status === 60 && (raw.aftersale_result === 'refunded' || raw.settled === true)) {
        info = { text: '已退款', icon: 'passed', desc: '退款已到账' }
      }

      const order = {
        ...raw,
        statusText: info.text,
        statusIcon: info.icon,
        statusDesc: info.desc,
        totalDisplay: formatFen(raw.total_price),
        productPriceDisplay: formatFen(
          raw.product_snapshot ? raw.product_snapshot.price : 0
        ),
        createTimeDisplay: formatTime(raw.create_time),
        payTimeDisplay: formatTime(raw.pay_time),
        shipTimeDisplay: formatTime(raw.ship_time),
        completeTimeDisplay: formatTime(raw.complete_time),
        ...getReviewState(raw)
      }

      this.setData({ order, loading: false })

      // 待付款订单：启动 30 分钟倒计时
      if (raw.status === 10 && raw.create_time) {
        this._startCountdown(raw.create_time)
      }

      // 已完成(40)订单：判断是否在售后窗口内 且 无活跃售后
      if (raw.status === 40 && raw.complete_time && !raw.settled && !raw.has_aftersale) {
        const completeMs = new Date(raw.complete_time).getTime()
        const windowEnd = completeMs + 7 * 24 * 3600 * 1000
        if (Date.now() < windowEnd) {
          const deadlineDate = new Date(windowEnd)
          const pad = n => String(n).padStart(2, '0')
          this.setData({
            canApplyAftersale: true,
            aftersaleDeadlineDisplay: `${pad(deadlineDate.getMonth() + 1)}-${pad(deadlineDate.getDate())} ${pad(deadlineDate.getHours())}:${pad(deadlineDate.getMinutes())}`
          })
        }
      }

      // 已完成/售后中：尝试加载售后记录（包含历史记录的展示）
      if (raw.status === 40 || raw.status === 60 || raw.has_aftersale) {
        this._loadAftersaleId(id)
      }
    } catch (err) {
      console.error('加载订单详情失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  /**
   * 启动支付倒计时
   * 创建时间 + 30 分钟 = 截止时间，每秒更新显示
   */
  _startCountdown(createTime) {
    const TIMEOUT_MS = 30 * 60 * 1000
    const deadline = new Date(createTime).getTime() + TIMEOUT_MS

    const tick = () => {
      const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000))
      const minutes = Math.floor(remaining / 60)
      const seconds = remaining % 60
      const pad = n => String(n).padStart(2, '0')
      this.setData({
        countdown: remaining,
        countdownDisplay: `${pad(minutes)}:${pad(seconds)}`
      })
      if (remaining === 0) this._clearTimer()
    }

    tick()
    this._timer = setInterval(tick, 1000)
  },

  /** 查看物流详情（快递100 API） */
  queryLogistics() {
    const { order } = this.data
    if (!order) return
    wx.navigateTo({
      url: `/pages/order/logistics?orderId=${order._id}`
    })
  },

  /** 复制快递单号 */
  copyTracking() {
    const { order } = this.data
    if (!order || !order.tracking_number) return
    wx.setClipboardData({
      data: order.tracking_number,
      success: () => wx.showToast({ title: '已复制单号', icon: 'success' })
    })
  },

  /** 复制订单号 */
  copyOrderId() {
    const { order } = this.data
    if (!order) return
    wx.setClipboardData({
      data: order._id,
      success: () => wx.showToast({ title: '已复制订单号', icon: 'success' })
    })
  },

  /** 取消订单 → 调用 cancel_order 云函数 */
  cancelOrder() {
    wx.showModal({
      title: '取消订单',
      content: '确认取消此订单？库存将自动归还。',
      confirmText: '确认取消',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '取消中...', mask: true })
        try {
          const { order } = this.data
          const cfRes = await wx.cloud.callFunction({
            name: 'cancel_order',
            data: { order_id: order._id }
          })
          wx.hideLoading()
          const result = cfRes.result
          if (result && result.success) {
            this._clearTimer()
            wx.showToast({ title: '订单已取消', icon: 'success' })
            setTimeout(() => this.loadOrder(order._id), 800)
          } else {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '取消失败', icon: 'none' })
        }
      }
    })
  },

  /** 打开支付键盘 */
  payOrder() {
    this.setData({ showPayKeyboard: true })
  },

  closePayKeyboard() {
    this.setData({ showPayKeyboard: false })
  },

  async onPayConfirm(e) {
    const { password } = e.detail
    const { order } = this.data
    if (!order) return

    this.setData({ paying: true })
    const keyboard = this.selectComponent('#payKeyboard')

    try {
      const res = await wx.cloud.callFunction({
        name: 'process_payment',
        data: { order_id: order._id, pay_password: password }
      })
      const result = res.result
      if (result && result.success) {
        this._clearTimer()
        this.setData({ showPayKeyboard: false, paying: false })
        wx.showToast({ title: '支付成功', icon: 'success' })
        setTimeout(() => this.loadOrder(order._id), 800)
      } else {
        this.setData({ paying: false })
        if (keyboard) keyboard.setError(result.message || '支付失败')
      }
    } catch (err) {
      this.setData({ paying: false })
      if (keyboard) keyboard.setError('网络异常，请重试')
    }
  },

  /** 确认收货 */
  confirmReceipt() {
    wx.showModal({
      title: '确认收货',
      content: '请确认您已收到商品。确认后进入7天售后保障期，期内可申请退货退款。',
      confirmText: '确认收货',
      confirmColor: '#8B2E2A',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const cfRes = await wx.cloud.callFunction({
            name: 'confirm_receipt',
            data: { order_id: this.data.order._id }
          })
          wx.hideLoading()
          const result = cfRes.result
          if (result && result.success) {
            wx.showToast({ title: '确认成功', icon: 'success' })
            setTimeout(() => this.loadOrder(this.data.order._id), 800)
          } else {
            wx.showToast({ title: result.message || '操作失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常，请重试', icon: 'none' })
        }
      }
    })
  },

  /** 通过云函数加载关联售后记录（管理员权限读取 + operation_logs） */
  async _loadAftersaleId(orderId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: { action: 'load_detail', order_id: orderId }
      })
      const r = res.result
      if (r && r.success && r.detail) {
        const as = r.detail
        const STATUS_TEXT = {
          0: '待审核', 1: '待寄回', 2: '待验收',
          3: '退款成功', '-1': '已拒绝', '-2': '售后关闭'
        }
        const logs = (as.operation_logs || []).map(log => ({
          ...log,
          timeDisplay: formatTime(log.time),
          operatorLabel: log.operator === 'buyer' ? '买家' : log.operator === 'seller' ? '卖家' : '系统'
        })).reverse()

        const updateData = {
          activeAftersaleId: as._id,
          aftersaleLog: {
            _id: as._id,
            type: as.type === 'refund_only' ? '仅退款' : '退货退款',
            statusText: STATUS_TEXT[String(as.status)] || '未知',
            status: as.status,
            reason: as.reason || '',
            refundDisplay: ((as.refund_fee || 0) / 100).toFixed(2),
            operationLogs: logs
          }
        }

        // 根据售后实际状态动态修正订单横幅显示
        if (this.data.order && this.data.order.status === 60) {
          if (as.status === 3) {
            updateData['order.statusText'] = '已退款'
            updateData['order.statusIcon'] = 'passed'
            updateData['order.statusDesc'] = `退款 ¥${((as.refund_fee || 0) / 100).toFixed(2)} 已到账`
          } else if (as.status === -1) {
            updateData['order.statusText'] = '售后被拒绝'
            updateData['order.statusIcon'] = 'close'
            updateData['order.statusDesc'] = '卖家拒绝了售后申请'
          } else if (as.status === -2) {
            updateData['order.statusText'] = '售后已关闭'
            updateData['order.statusIcon'] = 'info-o'
            updateData['order.statusDesc'] = '售后申请已关闭'
          }
        }

        this.setData(updateData)
      }
    } catch (_) {}
  },

  /** 申请售后 */
  applyAftersale() {
    const { order } = this.data
    if (!order) return
    wx.navigateTo({
      url: `/pages/aftersale/apply?orderId=${order._id}`
    })
  },

  /** 查看售后进度 */
  viewAftersale() {
    const { activeAftersaleId } = this.data
    if (activeAftersaleId) {
      wx.navigateTo({
        url: `/pages/aftersale/detail?id=${activeAftersaleId}`
      })
    }
  },

  /** 跳转商品详情 */
  goToReviewSubmit() {
    const { order } = this.data
    if (!order || !order._id) return
    wx.navigateTo({
      url: `/pages/review/submit?orderId=${order._id}`
    })
  },

  goToReviewDetail() {
    const { order } = this.data
    if (!order || !order.reviewId) {
      wx.showToast({ title: '评价信息不存在', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/review/detail?reviewId=${order.reviewId}`
    })
  },

  goToProduct() {
    const { order } = this.data
    const productId = order.product_snapshot && order.product_snapshot.product_id
    if (productId) {
      wx.navigateTo({ url: `/pages/mall/detail?id=${productId}` })
    }
  },

  goBack() {
    wx.navigateBack()
  }
})
