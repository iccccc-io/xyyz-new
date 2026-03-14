// pages/aftersale/apply.js
const db = wx.cloud.database()

Page({
  data: {
    orderId: '',
    order: null,
    totalDisplay: '0.00',
    isReapply: false,
    type: 'return_refund',
    reason: '',
    reasonDetail: '',
    reasonOptions: [
      '商品与描述不符',
      '商品质量问题',
      '商品损坏/有瑕疵',
      '未收到货',
      '不喜欢/不想要',
      '其他原因'
    ],
    fileList: [],
    submitting: false
  },

  onLoad(options) {
    if (options.orderId) {
      const isReapply = options.mode === 'reapply'
      this.setData({ orderId: options.orderId, isReapply })
      this.loadOrder(options.orderId)
    }
  },

  async loadOrder(id) {
    try {
      const res = await db.collection('shopping_orders').doc(id).get()
      const order = res.data
      this.setData({
        order,
        totalDisplay: (order.total_price / 100).toFixed(2)
      })
    } catch (err) {
      wx.showToast({ title: '加载订单失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  selectType(e) {
    this.setData({ type: e.currentTarget.dataset.type })
  },

  selectReason(e) {
    this.setData({ reason: e.currentTarget.dataset.reason })
  },

  onReasonInput(e) {
    this.setData({ reasonDetail: e.detail.value })
  },

  onAfterRead(e) {
    const { file } = e.detail
    const files = Array.isArray(file) ? file : [file]
    const newList = [...this.data.fileList]

    files.forEach(f => {
      newList.push({ ...f, status: 'uploading', message: '上传中' })
    })
    this.setData({ fileList: newList })

    files.forEach((f, i) => {
      const idx = this.data.fileList.length - files.length + i
      wx.cloud.uploadFile({
        cloudPath: `aftersale/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`,
        filePath: f.url || f.path,
        success: res => {
          this.setData({
            [`fileList[${idx}].url`]: res.fileID,
            [`fileList[${idx}].status`]: 'done',
            [`fileList[${idx}].message`]: ''
          })
        },
        fail: () => {
          this.setData({
            [`fileList[${idx}].status`]: 'failed',
            [`fileList[${idx}].message`]: '上传失败'
          })
        }
      })
    })
  },

  onDeleteImg(e) {
    const { index } = e.detail
    const list = [...this.data.fileList]
    list.splice(index, 1)
    this.setData({ fileList: list })
  },

  async submitApply() {
    const { orderId, type, reason, reasonDetail, fileList, submitting } = this.data
    if (submitting) return

    if (!reason) {
      wx.showToast({ title: '请选择退货原因', icon: 'none' })
      return
    }

    // 检查是否有还在上传的图片
    if (fileList.some(f => f.status === 'uploading')) {
      wx.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }

    const proofImgs = fileList
      .filter(f => f.status === 'done' || !f.status)
      .map(f => f.url)

    const fullReason = reasonDetail ? `${reason}：${reasonDetail}` : reason

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: {
          action: 'apply',
          order_id: orderId,
          type,
          reason: fullReason,
          proof_imgs: proofImgs
        }
      })

      wx.hideLoading()
      const result = res.result

      if (result && result.success) {
        wx.showToast({ title: '申请已提交', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/aftersale/detail?id=${result.aftersale_id}`
          })
        }, 1000)
      } else {
        this.setData({ submitting: false })
        wx.showToast({ title: result.message || '提交失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  }
})
