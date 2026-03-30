const app = getApp()

const CATEGORY_OPTIONS = [
  '湘绣',
  '滩头年画',
  '长沙花鼓戏',
  '苗族银饰',
  '湘西苗族鼓舞',
  '土家族织锦',
  '醴陵釉下五彩瓷',
  '湘西竹编',
  '桃源刺绣',
  '其他'
]

function getInputValue(e) {
  if (!e) return ''
  if (e.detail && typeof e.detail.value !== 'undefined') return e.detail.value
  if (typeof e.detail !== 'undefined') return e.detail
  return ''
}

Page({
  data: {
    realName: '',
    ichCategory: '',
    workshopName: '',
    workshopDesc: '',
    certFiles: [],
    logoFiles: [],
    showCategorySheet: false,
    categoryActions: CATEGORY_OPTIONS.map((name) => ({ name })),
    submitting: false
  },

  onRealNameInput(e) {
    this.setData({ realName: getInputValue(e) })
  },

  onWorkshopNameInput(e) {
    this.setData({ workshopName: getInputValue(e) })
  },

  onWorkshopDescInput(e) {
    this.setData({ workshopDesc: getInputValue(e) })
  },

  openCategorySheet() {
    this.setData({ showCategorySheet: true })
  },

  onCloseCategorySheet() {
    this.setData({ showCategorySheet: false })
  },

  onSelectCategory(e) {
    const { name } = e.detail || {}
    if (!name) return
    this.setData({
      ichCategory: name,
      showCategorySheet: false
    })
  },

  chooseCertImages() {
    const maxCount = 3 - this.data.certFiles.length
    if (maxCount <= 0) {
      wx.showToast({ title: '最多上传3张证书', icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((item) => ({ tempFilePath: item.tempFilePath }))
        this.uploadImages(files, 'certificates', 'certFiles')
      }
    })
  },

  chooseLogoImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file || !file.tempFilePath) return
        this.uploadImages([{ tempFilePath: file.tempFilePath }], 'workshop-logos', 'logoFiles', { replace: true })
      }
    })
  },

  async uploadImages(files, folder, stateKey, { replace = false } = {}) {
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file, index) => {
        const cloudPath = `${folder}/${Date.now()}_${index}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({
          cloudPath,
          filePath: file.tempFilePath
        })
      })

      const results = await Promise.all(tasks)
      const uploaded = results.map((item, index) => ({
        url: item.fileID,
        name: `${folder}_${Date.now()}_${index}`
      }))

      const currentList = replace ? [] : this.data[stateKey]
      this.setData({
        [stateKey]: currentList.concat(uploaded)
      })

      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  handleDeleteCert(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index)) return

    const certFiles = this.data.certFiles.slice()
    certFiles.splice(index, 1)
    this.setData({ certFiles })
  },

  handleDeleteLogo() {
    this.setData({ logoFiles: [] })
  },

  validateForm() {
    const realName = this.data.realName.trim()
    const ichCategory = this.data.ichCategory.trim()
    const workshopName = this.data.workshopName.trim()
    const workshopDesc = this.data.workshopDesc.trim()

    if (realName.length < 2) {
      wx.showToast({ title: '请输入真实姓名', icon: 'none' })
      return false
    }
    if (!ichCategory) {
      wx.showToast({ title: '请选择非遗类别', icon: 'none' })
      return false
    }
    if (workshopName.length < 2) {
      wx.showToast({ title: '请输入工坊名称', icon: 'none' })
      return false
    }
    if (!this.data.logoFiles.length) {
      wx.showToast({ title: '请上传工坊 Logo', icon: 'none' })
      return false
    }
    if (this.data.certFiles.length === 0) {
      wx.showToast({ title: '请至少上传一张证书', icon: 'none' })
      return false
    }
    if (workshopDesc.length < 10) {
      wx.showToast({ title: '主理人寄语至少10字', icon: 'none' })
      return false
    }
    return true
  },

  async submitApplication() {
    if (this.data.submitting) return
    if (!this.validateForm()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      const result = await wx.cloud.callFunction({
        name: 'apply_certification',
        data: {
          real_name: this.data.realName.trim(),
          ich_category: this.data.ichCategory,
          workshop_name: this.data.workshopName.trim(),
          workshop_logo: this.data.logoFiles[0].url,
          workshop_desc: this.data.workshopDesc.trim(),
          certificates: this.data.certFiles.map((file) => file.url)
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        if (app.globalData.userInfo) {
          app.setUserInfo({
            ...app.globalData.userInfo,
            is_certified: true,
            workshop_id: result.result.workshop_id,
            real_name: this.data.realName.trim(),
            ich_category: this.data.ichCategory
          })
        }

        wx.showModal({
          title: '认证成功',
          content: '工坊已创建完成，后续可继续编辑工坊资料。',
          confirmText: '进入工坊',
          confirmColor: '#b63b36',
          showCancel: false,
          success: () => {
            wx.redirectTo({
              url: `/pages/workshop/index?id=${result.result.workshop_id}`
            })
          }
        })
      } else {
        wx.showModal({
          title: '申请失败',
          content: (result.result && result.result.message) || '申请失败，请稍后重试',
          showCancel: false,
          confirmColor: '#b63b36'
        })
      }
    } catch (err) {
      console.error('提交失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '提交失败',
        content: '网络异常，请稍后重试',
        showCancel: false,
        confirmColor: '#b63b36'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
