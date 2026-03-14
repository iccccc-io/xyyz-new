const app = getApp()
const db = wx.cloud.database()

const CATEGORY_OPTIONS = [
  '手工体验',
  '非遗摆件',
  '地道风物',
  '文房雅器',
  '服饰配件',
  '家居装饰',
  '文创礼品',
  '其他'
]

Page({
  data: {
    title: '',
    intro: '',
    category: '',
    price: '',
    originalPrice: '',
    stock: '',
    projectId: '',
    projectName: '',
    origin: '',
    imageFiles: [],
    tagList: [
      { name: '手工体验', selected: false },
      { name: '新品', selected: false },
      { name: '大师作', selected: false },
      { name: '限量', selected: false },
      { name: '热卖', selected: false },
      { name: '匠心', selected: false },
      { name: '收藏级', selected: false },
      { name: '送礼佳品', selected: false }
    ],
    showCategorySheet: false,
    showProjectSheet: false,
    categoryActions: CATEGORY_OPTIONS.map((name) => ({ name })),
    projectActions: [],
    projectIdMap: {},
    loadingProjects: false,
    projectEmpty: false,
    submitting: false
  },

  onLoad() {
    this.loadProjectsFromDB()
  },

  onTitleInput(e) {
    this.setData({ title: e.detail })
  },

  onIntroInput(e) {
    this.setData({ intro: e.detail })
  },

  onPriceInput(e) {
    this.setData({ price: e.detail })
  },

  onOriginalPriceInput(e) {
    this.setData({ originalPrice: e.detail })
  },

  onStockInput(e) {
    this.setData({ stock: e.detail })
  },

  onOriginInput(e) {
    this.setData({ origin: e.detail })
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
      category: name,
      showCategorySheet: false
    })
  },

  openProjectSheet() {
    if (this.data.loadingProjects) {
      wx.showToast({ title: '项目加载中', icon: 'none' })
      return
    }
    this.setData({ showProjectSheet: true })
  },

  onCloseProjectSheet() {
    this.setData({ showProjectSheet: false })
  },

  onSelectProject(e) {
    const { name, disabled } = e.detail || {}
    if (disabled || !name) return
    const projectId = this.data.projectIdMap[name]
    this.setData({
      projectName: name,
      projectId: projectId || '',
      showProjectSheet: false
    })
  },

  async loadProjectsFromDB() {
    this.setData({ loadingProjects: true })
    try {
      const res = await db.collection('ich_projects')
        .field({ _id: true, title: true, name: true })
        .limit(200)
        .get()

      // 兼容 title 和 name 两种字段名
      const list = (res.data || [])
        .map((item) => {
          const projectName = item.title || item.name || ''
          return projectName ? String(projectName).trim() : ''
        })
        .filter((name) => name)

      const projectIdMap = {}
      ;(res.data || []).forEach((item) => {
        const projectName = item.title || item.name || ''
        if (projectName) {
          projectIdMap[String(projectName).trim()] = item._id
        }
      })

      if (list.length === 0) {
        this.setData({
          projectActions: [{ name: '暂无可选项目', disabled: true }],
          projectIdMap: {},
          projectEmpty: true
        })
      } else {
        this.setData({
          projectActions: list.map((name) => ({ name })),
          projectIdMap,
          projectEmpty: false
        })
      }
    } catch (err) {
      console.error('加载非遗项目失败:', err)
      this.setData({
        projectActions: [{ name: '加载失败，稍后重试', disabled: true }],
        projectIdMap: {},
        projectEmpty: true
      })
    } finally {
      this.setData({ loadingProjects: false })
    }
  },

  async afterReadImage(e) {
    const files = Array.isArray(e.detail.file) ? e.detail.file : [e.detail.file]
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file) => {
        // van-uploader 返回的临时路径在 file.url 中
        const filePath = file.url || file.tempFilePath || file.path
        const cloudPath = `products/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(tasks)
      const newFiles = results.map((item, index) => ({
        url: item.fileID,
        name: `img_${Date.now()}_${index}`
      }))
      this.setData({
        imageFiles: this.data.imageFiles.concat(newFiles)
      })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 选择图片（替代 van-uploader）
  chooseImages() {
    const maxCount = 9 - this.data.imageFiles.length
    if (maxCount <= 0) {
      wx.showToast({ title: '最多上传9张图片', icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = res.tempFiles.map(f => ({ tempFilePath: f.tempFilePath }))
        this.uploadChosenImages(files)
      }
    })
  },

  // 上传选中的图片
  async uploadChosenImages(files) {
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file) => {
        const filePath = file.tempFilePath
        const cloudPath = `products/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(tasks)
      const newFiles = results.map((item, index) => ({
        url: item.fileID,
        name: `img_${Date.now()}_${index}`
      }))
      this.setData({
        imageFiles: this.data.imageFiles.concat(newFiles)
      })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 自定义删除图片
  handleDeleteImage(e) {
    const index = e.currentTarget.dataset.index
    if (typeof index === 'number' && index >= 0 && index < this.data.imageFiles.length) {
      const imageFiles = this.data.imageFiles.slice()
      imageFiles.splice(index, 1)
      this.setData({ imageFiles })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1000 })
    }
  },

  onDeleteImage(e) {
    // van-uploader 的 delete 事件备用
    const detail = e.detail || {}
    const index = detail.index
    if (typeof index === 'number' && index >= 0 && index < this.data.imageFiles.length) {
      const imageFiles = this.data.imageFiles.slice()
      imageFiles.splice(index, 1)
      this.setData({ imageFiles })
    }
  },

  toggleTag(e) {
    const { index } = e.currentTarget.dataset
    const tagList = this.data.tagList.slice()
    if (tagList[index]) {
      tagList[index].selected = !tagList[index].selected
      this.setData({ tagList })
    }
  },

  validateForm() {
    const title = (this.data.title || '').trim()
    const intro = (this.data.intro || '').trim()
    const category = (this.data.category || '').trim()
    const price = Number(this.data.price)
    const originalPrice = this.data.originalPrice ? Number(this.data.originalPrice) : 0
    const stock = Number(this.data.stock)

    if (this.data.imageFiles.length === 0) {
      wx.showToast({ title: '请至少上传一张商品图片', icon: 'none' })
      return false
    }
    if (title.length < 5) {
      wx.showToast({ title: '商品标题至少5个字', icon: 'none' })
      return false
    }
    if (intro.length < 20) {
      wx.showToast({ title: '商品描述至少20字', icon: 'none' })
      return false
    }
    if (!category) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' })
      return false
    }
    if (!price || price <= 0) {
      wx.showToast({ title: '请输入正确的现价（元）', icon: 'none' })
      return false
    }
    if (this.data.originalPrice && (!originalPrice || originalPrice < price)) {
      wx.showToast({ title: '原价应不低于现价', icon: 'none' })
      return false
    }
    if (!stock || stock <= 0 || !Number.isInteger(stock)) {
      wx.showToast({ title: '请输入正确的库存数量（正整数）', icon: 'none' })
      return false
    }
    if (!this.data.projectId) {
      wx.showToast({ title: '请选择关联的非遗项目', icon: 'none' })
      return false
    }
    return true
  },

  ensureCertified() {
    const userInfo = app.globalData.userInfo
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return false
    }
    if (!userInfo.is_certified) {
      wx.showModal({
        title: '需要认证',
        content: '只有认证传承人才能发布商品',
        confirmText: '去认证',
        confirmColor: '#b63b36',
        success: (res) => {
          if (res.confirm) {
            wx.redirectTo({ url: '/pages/certification/apply' })
          }
        }
      })
      return false
    }
    return true
  },

  async submitProduct() {
    if (this.data.submitting) return
    if (!this.ensureCertified()) return
    if (!this.validateForm()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...', mask: true })

    try {
      const selectedTags = this.data.tagList
        .filter((tag) => tag.selected)
        .map((tag) => tag.name)

      // 用户输入元，存储统一使用分（×100），严格遵守顶层设计规范
      const priceYuan = Number(this.data.price)
      const originalPriceYuan = this.data.originalPrice ? Number(this.data.originalPrice) : priceYuan
      const priceFen = Math.round(priceYuan * 100)
      const originalPriceFen = Math.round(originalPriceYuan * 100)

      const result = await wx.cloud.callFunction({
        name: 'add_shopping_product',
        data: {
          title: this.data.title.trim(),
          intro: this.data.intro.trim(),
          category: this.data.category,
          price: priceFen,
          original_price: originalPriceFen,
          stock: Number(this.data.stock),
          cover_img: this.data.imageFiles[0].url,
          detail_imgs: this.data.imageFiles.map((file) => file.url),
          related_project_id: this.data.projectId,
          related_project_name: this.data.projectName,
          origin: this.data.origin.trim(),
          tags: selectedTags
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/mall/detail?id=${result.result.product_id}` })
        }, 1200)
      } else {
        wx.showModal({
          title: '发布失败',
          content: (result.result && result.result.message) || '发布失败，请稍后重试',
          showCancel: false,
          confirmColor: '#b63b36'
        })
      }
    } catch (err) {
      console.error('发布失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '发布失败',
        content: '网络异常，请稍后重试',
        showCancel: false,
        confirmColor: '#b63b36'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})

