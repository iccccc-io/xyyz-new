// pages/aftersale/detail.js
// 通过云函数 manage_aftersale(load_detail) 加载数据
// 角色由云函数返回，前端不做本地判断，杜绝权限错位
const app = getApp()

const STATUS_MAP = {
  0:  { text: '待审核', icon: 'clock-o',   desc: '等待卖家审核（48小时内未处理系统自动通过）' },
  1:  { text: '待寄回', icon: 'logistics', desc: '卖家已同意退货，请尽快寄回（7天内）' },
  2:  { text: '待验收', icon: 'eye-o',     desc: '退货已寄出，等待卖家验货（10天内未处理自动退款）' },
  3:  { text: '退款成功', icon: 'passed',  desc: '退款已到账' },
  '-1': { text: '已拒绝', icon: 'close',   desc: '卖家拒绝了售后申请' },
  '-2': { text: '售后关闭', icon: 'info-o', desc: '售后已关闭' }
}

const TICKET_TEETH = Array.from({ length: 16 }, (_, index) => index)

const CARRIERS = [
  { code: 'SF', name: '顺丰' }, { code: 'YTO', name: '圆通' },
  { code: 'ZTO', name: '中通' }, { code: 'STO', name: '申通' },
  { code: 'YUNDA', name: '韵达' }, { code: 'JD', name: '京东' },
  { code: 'EMS', name: 'EMS' }, { code: 'OTHER', name: '其他' }
]

function fmtTime(val) {
  if (!val) return ''
  const d = typeof val === 'string' ? new Date(val) : (val instanceof Date ? val : new Date(val))
  if (isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    loading: true,
    role: 'visitor',    // 'buyer' | 'seller' | 'visitor' — 由云函数返回
    ticketEntered: false,
    ticketTeeth: TICKET_TEETH,
    detail: null,
    order: null,
    statusInfo: {},
    orderTotalDisplay: '0.00',
    operationLogs: [],  // 格式化后的操作日志
    carriers: CARRIERS,
    // 弹窗状态
    showShipPopup: false,
    shipForm: { com: '', num: '' },
    shipSubmitting: false,
    showRejectPopup: false,
    rejectReason: '',
    rejectSubmitting: false,
    showApprovePopup: false,
    savedAddresses: [],
    selectedAddrIdx: -1,
    showManualAddr: false,
    returnAddr: { name: '', phone: '', province: '', city: '', district: '', detail: '' },
    approveSubmitting: false
  },

  _ticketTimer: null,

  onLoad(options) {
    this._asId = options.id || ''
    this._orderId = options.orderId || ''
    this._from = options.from || 'buyer'
    this._loadData()
  },

  onShow() {
    if (this._asId || this._orderId) this._loadData()
  },

  onUnload() {
    this._clearTicketTimer()
  },

  _clearTicketTimer() {
    if (this._ticketTimer) {
      clearTimeout(this._ticketTimer)
      this._ticketTimer = null
    }
  },

  /** 通过云函数加载（管理员权限，买卖双方均可读） */
  async _loadData() {
    this._clearTicketTimer()
    this.setData({ loading: true, ticketEntered: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: {
          action: 'load_detail',
          aftersale_id: this._asId,
          order_id: this._orderId,
          view_as: this._from
        }
      })
      const r = res.result
      if (!r || !r.success) {
        this.setData({ loading: false })
        wx.showToast({ title: r ? r.message : '加载失败', icon: 'none' })
        return
      }

      const raw = r.detail
      this._asId = raw._id

      const detail = {
        ...raw,
        refundDisplay: ((raw.refund_fee || 0) / 100).toFixed(2)
      }

      const statusInfo = STATUS_MAP[String(raw.status)] || { text: '未知', icon: 'question-o', desc: '' }

      // 格式化 operation_logs
      const operationLogs = (raw.operation_logs || []).map(log => ({
        ...log,
        timeDisplay: fmtTime(log.time),
        operatorLabel: log.operator === 'buyer' ? '买家' : log.operator === 'seller' ? '卖家' : '系统'
      })).reverse()  // 最新的在上面

      const order = r.order
      const orderTotalDisplay = order ? ((order.total_price || 0) / 100).toFixed(2) : '0.00'

      this.setData({
        loading: false,
        ticketEntered: false,
        role: r.role,       // 由云函数严格判定
        detail,
        order,
        statusInfo,
        orderTotalDisplay,
        operationLogs
      })

      this._ticketTimer = setTimeout(() => {
        this.setData({ ticketEntered: true })
        this._ticketTimer = null
      }, 40)
    } catch (err) {
      console.error('加载售后详情失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  previewImg(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.detail.proof_imgs || []
    })
  },

  // ==================== 买家操作 ====================

  cancelAftersale() {
    wx.showModal({
      title: '撤销售后',
      content: '确认撤销售后申请？订单将恢复正常结算。',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const r = (await wx.cloud.callFunction({
            name: 'manage_aftersale',
            data: { action: 'cancel', aftersale_id: this._asId }
          })).result
          wx.hideLoading()
          if (r && r.success) {
            wx.showToast({ title: '已撤销', icon: 'success' })
            setTimeout(() => this._loadData(), 800)
          } else {
            wx.showToast({ title: r.message || '失败', icon: 'none' })
          }
        } catch (e) { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }) }
      }
    })
  },

  /** 修改后重新提交 → 跳到申请页（修改模式） */
  reapply() {
    const { detail } = this.data
    wx.navigateTo({
      url: `/pages/aftersale/apply?orderId=${detail.order_id}&mode=reapply`
    })
  },

  // --- 退货物流弹窗 ---
  openShipPopup() { this.setData({ showShipPopup: true }) },
  closeShipPopup() { this.setData({ showShipPopup: false }) },
  selectCarrier(e) { this.setData({ 'shipForm.com': e.currentTarget.dataset.code }) },
  onTrackingInput(e) { this.setData({ 'shipForm.num': e.detail }) },

  async submitShipReturn() {
    const { shipForm, shipSubmitting } = this.data
    if (shipSubmitting) return
    if (!shipForm.com) return wx.showToast({ title: '请选择快递公司', icon: 'none' })
    if (!shipForm.num || shipForm.num.trim().length < 5) return wx.showToast({ title: '请输入有效单号', icon: 'none' })

    this.setData({ shipSubmitting: true })
    try {
      const r = (await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: { action: 'ship_return', aftersale_id: this._asId, logistics_com: shipForm.com, logistics_num: shipForm.num.trim() }
      })).result
      this.setData({ shipSubmitting: false })
      if (r && r.success) {
        this.setData({ showShipPopup: false })
        wx.showToast({ title: '已提交', icon: 'success' })
        setTimeout(() => this._loadData(), 800)
      } else {
        wx.showToast({ title: r.message || '失败', icon: 'none' })
      }
    } catch (e) { this.setData({ shipSubmitting: false }); wx.showToast({ title: '网络异常', icon: 'none' }) }
  },

  // ==================== 卖家操作 ====================

  openRejectPopup() { this.setData({ showRejectPopup: true }) },
  closeRejectPopup() { this.setData({ showRejectPopup: false }) },
  onRejectInput(e) { this.setData({ rejectReason: e.detail.value }) },

  async submitReject() {
    const { rejectReason, rejectSubmitting } = this.data
    if (rejectSubmitting) return
    if (!rejectReason || rejectReason.trim().length < 2) return wx.showToast({ title: '请填写拒绝原因', icon: 'none' })

    this.setData({ rejectSubmitting: true })
    try {
      const r = (await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: { action: 'reject', aftersale_id: this._asId, reject_reason: rejectReason.trim() }
      })).result
      this.setData({ rejectSubmitting: false })
      if (r && r.success) {
        this.setData({ showRejectPopup: false })
        wx.showToast({ title: '已拒绝', icon: 'success' })
        setTimeout(() => this._loadData(), 800)
      } else {
        wx.showToast({ title: r.message || '失败', icon: 'none' })
      }
    } catch (e) { this.setData({ rejectSubmitting: false }); wx.showToast({ title: '网络异常', icon: 'none' }) }
  },

  async openApprovePopup() {
    this.setData({ showApprovePopup: true, selectedAddrIdx: -1, showManualAddr: false })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('shopping_addresses')
        .where({ _openid: app.globalData.openid })
        .orderBy('is_default', 'desc')
        .orderBy('update_time', 'desc')
        .limit(20).get()
      const list = res.data || []
      this.setData({ savedAddresses: list })
      if (list.length === 0) this.setData({ showManualAddr: true })
    } catch (_) {
      this.setData({ showManualAddr: true })
    }
  },
  closeApprovePopup() { this.setData({ showApprovePopup: false }) },

  selectSavedAddr(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const addr = this.data.savedAddresses[idx]
    if (!addr) return
    this.setData({
      selectedAddrIdx: idx,
      showManualAddr: false,
      returnAddr: {
        name: addr.name, phone: addr.phone,
        province: addr.province || '', city: addr.city || '',
        district: addr.district || '', detail: addr.detail
      }
    })
  },

  switchToManual() {
    this.setData({
      showManualAddr: true,
      selectedAddrIdx: -1,
      returnAddr: { name: '', phone: '', province: '', city: '', district: '', detail: '' }
    })
  },

  switchBackToList() {
    this.setData({ showManualAddr: false, selectedAddrIdx: -1 })
  },

  onAddrName(e) { this.setData({ 'returnAddr.name': e.detail }) },
  onAddrPhone(e) { this.setData({ 'returnAddr.phone': e.detail }) },
  onAddrRegion(e) {
    const [p, c, d] = e.detail.value
    this.setData({ 'returnAddr.province': p, 'returnAddr.city': c, 'returnAddr.district': d })
  },
  onAddrDetail(e) { this.setData({ 'returnAddr.detail': e.detail }) },

  async submitApprove() {
    const { returnAddr, approveSubmitting, detail } = this.data
    if (approveSubmitting) return

    // 仅退款不需要地址
    if (detail.type !== 'refund_only') {
      if (!returnAddr.name) return wx.showToast({ title: '请选择或填写收件人', icon: 'none' })
      if (!returnAddr.phone) return wx.showToast({ title: '请选择或填写手机号', icon: 'none' })
      if (!returnAddr.detail) return wx.showToast({ title: '请选择或填写详细地址', icon: 'none' })
    }

    this.setData({ approveSubmitting: true })
    try {
      const r = (await wx.cloud.callFunction({
        name: 'manage_aftersale',
        data: {
          action: 'approve', aftersale_id: this._asId,
          return_address: {
            name: returnAddr.name, phone: returnAddr.phone,
            province: returnAddr.province || '', city: returnAddr.city || '',
            district: returnAddr.district || '', detail: returnAddr.detail
          }
        }
      })).result
      this.setData({ approveSubmitting: false })
      if (r && r.success) {
        this.setData({ showApprovePopup: false })
        wx.showToast({ title: '已同意', icon: 'success' })
        setTimeout(() => this._loadData(), 800)
      } else {
        wx.showToast({ title: r.message || '失败', icon: 'none' })
      }
    } catch (e) { this.setData({ approveSubmitting: false }); wx.showToast({ title: '网络异常', icon: 'none' }) }
  },

  confirmReturn() {
    wx.showModal({
      title: '确认退货并退款',
      content: '确认已收到退货？退款立即执行，不可撤销。',
      confirmColor: '#8B2E2A',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '退款中...', mask: true })
        try {
          const r = (await wx.cloud.callFunction({
            name: 'manage_aftersale',
            data: { action: 'confirm_return', aftersale_id: this._asId }
          })).result
          wx.hideLoading()
          if (r && r.success) {
            wx.showToast({ title: '退款成功', icon: 'success' })
            setTimeout(() => this._loadData(), 800)
          } else {
            wx.showToast({ title: r.message || '退款失败', icon: 'none' })
          }
        } catch (e) { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }) }
      }
    })
  }
})
