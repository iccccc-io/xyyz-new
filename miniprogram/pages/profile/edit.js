const app = getApp()
const db = wx.cloud.database()
const {
  createDefaultUserProfile,
  normalizeUserProfile,
  sanitizeUserBio,
  validateUserBio,
  getUserBioLength,
  USER_BIO_MAX_LENGTH,
  USER_BIO_MAX_LINES
} = require('../../common/user-profile')

const DEFAULT_AVATAR = '/images/icons/avatar.png'

function getFileExtension(path) {
  const match = String(path || '').match(/(\.[a-zA-Z0-9]+)(?:$|\?)/)
  return match ? match[1].toLowerCase() : '.jpg'
}

function createUploadList(url = '', name = '') {
  return url
    ? [{ url, name: name || `file_${Date.now()}` }]
    : []
}

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    loading: true,
    submitting: false,
    bioMaxLength: USER_BIO_MAX_LENGTH,
    bioMaxLines: USER_BIO_MAX_LINES,
    form: createDefaultUserProfile(),
    originalUser: createDefaultUserProfile(),
    bioLength: 0,
    nicknameLength: 0,
    avatarFiles: [],
    coverFiles: [],
    saveButtonText: '保存',
    saveButtonClass: ''
  },

  async onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20,
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })

    if (!app.checkLogin()) {
      app.requireLogin('/pages/profile/edit')
      this.setData({ loading: false })
      return
    }

    await this.loadUserInfo()
  },

  async loadUserInfo() {
    try {
      const latestUser = await app.refreshUserInfo({ syncDefaults: true, notify: false })
      const normalized = normalizeUserProfile(latestUser || app.globalData.userInfo || {})
      const nextForm = {
        ...normalized,
        bio: sanitizeUserBio(normalized.bio || '')
      }
      this.setData({
        loading: false,
        form: nextForm,
        originalUser: nextForm,
        bioLength: getUserBioLength(nextForm.bio || ''),
        nicknameLength: (nextForm.nickname || '').length,
        avatarFiles: createUploadList(nextForm.avatar_url || DEFAULT_AVATAR, 'avatar'),
        coverFiles: createUploadList(nextForm.profile_bg_url, 'cover')
      })
    } catch (err) {
      console.error('加载用户资料失败:', err)
      const fallbackUser = normalizeUserProfile(app.globalData.userInfo || {})
      const nextForm = {
        ...fallbackUser,
        bio: sanitizeUserBio(fallbackUser.bio || '')
      }
      this.setData({
        loading: false,
        form: nextForm,
        originalUser: nextForm,
        bioLength: getUserBioLength(nextForm.bio || ''),
        nicknameLength: (nextForm.nickname || '').length,
        avatarFiles: createUploadList(nextForm.avatar_url || DEFAULT_AVATAR, 'avatar'),
        coverFiles: createUploadList(nextForm.profile_bg_url, 'cover')
      })
      wx.showToast({
        title: '资料加载失败',
        icon: 'none'
      })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  onNicknameInput(e) {
    const nickname = e.detail.value || ''
    this.setData({
      'form.nickname': nickname,
      nicknameLength: nickname.length
    })
  },

  async onNicknameBlur(e) {
    const nickname = e.detail.value || ''
    this.setData({
      'form.nickname': nickname,
      nicknameLength: nickname.length
    })

    await this.checkNicknameUnique({
      nickname,
      silent: true
    })
  },

  onBioInput(e) {
    const bio = sanitizeUserBio(e.detail.value || '')
    this.setData({
      'form.bio': bio,
      bioLength: getUserBioLength(bio)
    })
  },

  async chooseAndUploadImage(folder, stateKey) {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      const file = chooseRes.tempFiles && chooseRes.tempFiles[0]
      if (!file || !file.tempFilePath) return

      const openid = app.globalData.openid || (app.globalData.userInfo && app.globalData.userInfo._openid) || ''
      if (!openid) {
        throw new Error('missing openid')
      }

      wx.showLoading({ title: '上传中...', mask: true })
      const ext = getFileExtension(file.tempFilePath)
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `${folder}/${openid}_${Date.now()}${ext}`,
        filePath: file.tempFilePath
      })

      this.setData({
        [stateKey]: [{
          url: uploadRes.fileID,
          name: `${folder}_${Date.now()}`
        }]
      })
      wx.hideLoading()
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return
      console.error('上传图片失败:', err)
      wx.showToast({
        title: '上传失败',
        icon: 'none'
      })
    }
  },

  chooseAvatar() {
    this.chooseAndUploadImage('avatars', 'avatarFiles')
  },

  chooseProfileBg() {
    this.chooseAndUploadImage('profile-backgrounds', 'coverFiles')
  },

  removeAvatar() {
    this.setData({
      avatarFiles: []
    })
  },

  clearProfileBg() {
    this.setData({
      coverFiles: []
    })
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({
      urls: [url],
      current: url
    })
  },

  validateForm() {
    const nickname = (this.data.form.nickname || '').trim()
    const bio = sanitizeUserBio(this.data.form.bio || '')
    const avatarUrl = this.data.avatarFiles[0] && this.data.avatarFiles[0].url
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      })
      return false
    }
    if (nickname.length > 20) {
      wx.showToast({
        title: '昵称最多20字',
        icon: 'none'
      })
      return false
    }
    const bioValidation = validateUserBio(bio)
    if (!bioValidation.valid) {
      wx.showToast({
        title: bioValidation.message,
        icon: 'none'
      })
      return false
    }
    if (!avatarUrl) {
      wx.showToast({
        title: '请上传个人头像',
        icon: 'none'
      })
      return false
    }
    return true
  },

  async checkNicknameUnique({ nickname = '', silent = false } = {}) {
    const safeNickname = String(nickname || '').trim()
    if (!safeNickname) return false

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_user_profile',
        data: {
          action: 'check_nickname',
          nickname: safeNickname,
          exclude_self: true
        }
      })

      const result = res.result || {}
      if (result.success) {
        return true
      }

      if (!silent) {
        wx.showToast({
          title: result.message || '昵称不可用',
          icon: 'none'
        })
      }
      return false
    } catch (err) {
      console.error('昵称唯一性校验失败:', err)
      if (!silent) {
        wx.showToast({
          title: '昵称校验失败，请稍后重试',
          icon: 'none'
        })
      }
      return false
    }
  },

  async onSave() {
    if (this.data.submitting) return
    if (!this.validateForm()) return

    const nicknameUnique = await this.checkNicknameUnique({
      nickname: this.data.form.nickname,
      silent: false
    })
    if (!nicknameUnique) return

    const originalUser = normalizeUserProfile(this.data.originalUser || {})
    const form = normalizeUserProfile(this.data.form || {})

    this.setData({
      submitting: true,
      saveButtonText: '保存中',
      saveButtonClass: 'is-disabled'
    })
    wx.showLoading({
      title: '保存中...',
      mask: true
    })

    try {
      const avatarUrl = this.data.avatarFiles[0] ? this.data.avatarFiles[0].url : ''
      const backgroundUrl = this.data.coverFiles[0] ? this.data.coverFiles[0].url : ''

      const patch = {
        nickname: (form.nickname || '').trim(),
        avatar_url: avatarUrl || '',
        avatar_file_id: avatarUrl || '',
        avatar: avatarUrl || '',
        bio: sanitizeUserBio((form.bio || '').trim()),
        profile_bg_url: backgroundUrl || ''
      }

      const updateRes = await wx.cloud.callFunction({
        name: 'manage_user_profile',
        data: {
          action: 'update_profile',
          nickname: patch.nickname,
          avatar_url: patch.avatar_url,
          bio: patch.bio,
          profile_bg_url: patch.profile_bg_url
        }
      })
      const updateResult = updateRes.result || {}
      if (!updateResult.success || !updateResult.user) {
        throw new Error(updateResult.message || '保存失败')
      }

      const nextUserInfo = app.setUserInfo({
        ...originalUser,
        ...normalizeUserProfile(updateResult.user)
      })

      this.setData({
        originalUser: nextUserInfo,
        form: nextUserInfo,
        bioLength: getUserBioLength(nextUserInfo.bio || ''),
        nicknameLength: (nextUserInfo.nickname || '').length,
        avatarFiles: createUploadList(nextUserInfo.avatar_url || DEFAULT_AVATAR, 'avatar'),
        coverFiles: createUploadList(nextUserInfo.profile_bg_url, 'cover')
      })

      const eventChannel = this.getOpenerEventChannel()
      if (eventChannel) {
        eventChannel.emit('profileUpdated', nextUserInfo)
      }

      const deleteList = []
      if (
        originalUser.avatar_url &&
        originalUser.avatar_url !== avatarUrl &&
        String(originalUser.avatar_url).startsWith('cloud://')
      ) {
        deleteList.push(originalUser.avatar_url)
      }
      if (
        originalUser.profile_bg_url &&
        originalUser.profile_bg_url !== backgroundUrl &&
        String(originalUser.profile_bg_url).startsWith('cloud://')
      ) {
        deleteList.push(originalUser.profile_bg_url)
      }
      if (deleteList.length) {
        wx.cloud.deleteFile({ fileList: deleteList }).catch((err) => {
          console.warn('旧资源清理失败:', err)
        })
      }

      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })

      setTimeout(() => {
        wx.navigateBack()
      }, 500)
    } catch (err) {
      console.error('保存资料失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({
        submitting: false,
        saveButtonText: '保存',
        saveButtonClass: ''
      })
    }
  }
})
