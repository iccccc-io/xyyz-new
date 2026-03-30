const app = getApp()
const db = wx.cloud.database()
const {
  createDefaultUserProfile,
  normalizeUserProfile
} = require('../../common/user-profile')

const DEFAULT_AVATAR = '/images/icons/avatar.png'

function isTempFilePath(value = '') {
  return /^(wxfile:\/\/|http:\/\/tmp|https:\/\/tmp|file:\/\/)/.test(String(value || ''))
}

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    loading: true,
    submitting: false,
    form: createDefaultUserProfile(),
    originalUser: createDefaultUserProfile(),
    defaultAvatar: DEFAULT_AVATAR,
    bioLength: 0,
    avatarPreviewUrl: DEFAULT_AVATAR,
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
      this.setData({
        loading: false,
        form: normalized,
        originalUser: normalized,
        bioLength: (normalized.bio || '').length,
        avatarPreviewUrl: normalized.avatar_url || DEFAULT_AVATAR
      })
    } catch (err) {
      console.error('加载用户资料失败:', err)
      const fallbackUser = normalizeUserProfile(app.globalData.userInfo || {})
      this.setData({
        loading: false,
        form: fallbackUser,
        originalUser: fallbackUser,
        bioLength: (fallbackUser.bio || '').length,
        avatarPreviewUrl: fallbackUser.avatar_url || DEFAULT_AVATAR
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
    this.setData({
      'form.nickname': e.detail.value
    })
  },

  onBioInput(e) {
    const bio = e.detail.value || ''
    this.setData({
      'form.bio': bio,
      bioLength: bio.length
    })
  },

  async chooseAvatar() {
    const file = await this.chooseSingleImage()
    if (!file) return
    this.setData({
      'form.avatar_url': file,
      'form.avatar_file_id': file,
      'form.avatar': file,
      avatarPreviewUrl: file
    })
  },

  async chooseProfileBg() {
    const file = await this.chooseSingleImage()
    if (!file) return
    this.setData({
      'form.profile_bg_url': file
    })
  },

  clearProfileBg() {
    this.setData({
      'form.profile_bg_url': ''
    })
  },

  chooseSingleImage() {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0]
          resolve(file && file.tempFilePath ? file.tempFilePath : '')
        },
        fail: (err) => {
          if (err && err.errMsg !== 'chooseMedia:fail cancel') {
            wx.showToast({
              title: '选择图片失败',
              icon: 'none'
            })
          }
          resolve('')
        }
      })
    })
  },

  async uploadIfNeeded(filePath, folder) {
    if (!filePath || !isTempFilePath(filePath)) return filePath
    const openid = app.globalData.openid || (app.globalData.userInfo && app.globalData.userInfo._openid) || ''
    if (!openid) {
      throw new Error('missing openid')
    }
    const ext = /\.png$/i.test(filePath) ? 'png' : 'jpg'
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath: `${folder}/${openid}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`,
      filePath
    })
    return uploadRes.fileID
  },

  validateForm() {
    const nickname = (this.data.form.nickname || '').trim()
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
    return true
  },

  async onSave() {
    if (this.data.submitting) return
    if (!this.validateForm()) return

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
      const avatarUrl = await this.uploadIfNeeded(form.avatar_url, 'avatars')
      const backgroundUrl = await this.uploadIfNeeded(form.profile_bg_url, 'profile-backgrounds')
      const now = new Date()

      const patch = {
        nickname: (form.nickname || '').trim(),
        avatar_url: avatarUrl || '',
        avatar_file_id: avatarUrl || '',
        avatar: avatarUrl || '',
        bio: (form.bio || '').trim(),
        profile_bg_url: backgroundUrl || '',
        update_time: now
      }

      await db.collection('users').doc(originalUser._id).update({
        data: patch
      })

      const nextUserInfo = app.setUserInfo({
        ...originalUser,
        ...patch
      })

      this.setData({
        originalUser: nextUserInfo,
        form: nextUserInfo,
        bioLength: (nextUserInfo.bio || '').length,
        avatarPreviewUrl: nextUserInfo.avatar_url || DEFAULT_AVATAR
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
