const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const USER_BIO_MAX_LENGTH = 60
const USER_BIO_MAX_LINES = 5

const DEFAULT_USER_STATS = {
  following: 0,
  followers: 0,
  likes: 0,
  views: 0
}

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLineBreaks(text = '') {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function getTextLength(text = '') {
  return Array.from(String(text || '')).length
}

function getUserBioLineCount(text = '') {
  const normalized = normalizeLineBreaks(text)
  if (!normalized) return 0
  return normalized.split('\n').length
}

function sanitizeUserBio(text = '') {
  const normalized = normalizeLineBreaks(text)
  const lines = normalized.split('\n').slice(0, USER_BIO_MAX_LINES)

  let output = ''
  lines.forEach((line, index) => {
    const next = index === 0 ? line : `\n${line}`
    const nextLength = getTextLength(output + next)
    if (nextLength <= USER_BIO_MAX_LENGTH) {
      output += next
      return
    }

    const remain = USER_BIO_MAX_LENGTH - getTextLength(output)
    if (remain > 0) {
      output += Array.from(next).slice(0, remain).join('')
    }
  })

  return output
}

function validateNickname(nickname) {
  const safeNickname = getSafeString(nickname)
  if (!safeNickname) {
    throw new Error('请输入昵称')
  }
  if (getTextLength(safeNickname) > 20) {
    throw new Error('昵称最多20字')
  }
  return safeNickname
}

function validateBio(bio = '') {
  const normalized = normalizeLineBreaks(bio)
  const length = getTextLength(normalized)
  const lineCount = getUserBioLineCount(normalized)

  if (length > USER_BIO_MAX_LENGTH) {
    throw new Error(`个人简介最多${USER_BIO_MAX_LENGTH}字`)
  }
  if (lineCount > USER_BIO_MAX_LINES) {
    throw new Error(`个人简介最多${USER_BIO_MAX_LINES}行`)
  }

  return sanitizeUserBio(normalized)
}

function normalizeUserRecord(user = {}) {
  const avatarUrl = getSafeString(user.avatar_url || user.avatar_file_id || user.avatar)
  return {
    _id: user._id || '',
    _openid: user._openid || '',
    nickname: getSafeString(user.nickname),
    avatar_url: avatarUrl,
    avatar_file_id: getSafeString(user.avatar_file_id || avatarUrl),
    avatar: getSafeString(user.avatar || avatarUrl),
    bio: normalizeLineBreaks(user.bio || ''),
    profile_bg_url: getSafeString(user.profile_bg_url),
    is_certified: Boolean(user.is_certified),
    real_name: getSafeString(user.real_name),
    ich_category: getSafeString(user.ich_category),
    workshop_id: getSafeString(user.workshop_id),
    draft_count: Number(user.draft_count) || 0,
    stats: {
      ...DEFAULT_USER_STATS,
      ...((user && user.stats) || {})
    }
  }
}

async function getUserByOpenid(openid) {
  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()

  return (res.data && res.data[0]) || null
}

async function ensureNicknameUnique(nickname, { excludeUserId = '', excludeOpenid = '' } = {}) {
  const safeNickname = getSafeString(nickname)
  if (!safeNickname) return

  const res = await db.collection('users')
    .where({ nickname: safeNickname })
    .limit(20)
    .get()

  const conflict = (res.data || []).find((item) => {
    if (!item) return false
    if (excludeUserId && item._id === excludeUserId) return false
    if (excludeOpenid && item._openid === excludeOpenid) return false
    return true
  })

  if (conflict) {
    throw new Error('昵称已被使用，请换一个昵称')
  }
}

async function checkNickname(event, openid) {
  const nickname = validateNickname(event.nickname)
  const excludeSelf = event.exclude_self !== false
  const currentUser = excludeSelf && openid ? await getUserByOpenid(openid) : null

  await ensureNicknameUnique(nickname, {
    excludeUserId: currentUser ? currentUser._id : '',
    excludeOpenid: excludeSelf ? openid : ''
  })

  return {
    success: true,
    available: true,
    message: '昵称可用'
  }
}

async function registerUser(event, openid) {
  if (!openid) {
    throw new Error('获取用户身份失败，请稍后重试')
  }

  const existingUser = await getUserByOpenid(openid)
  if (existingUser) {
    return {
      success: true,
      existed: true,
      message: '用户已注册',
      user: normalizeUserRecord(existingUser)
    }
  }

  const nickname = validateNickname(event.nickname)
  const avatarUrl = getSafeString(event.avatar_url || event.avatar_file_id || event.avatar)
  const bio = validateBio(event.bio || '')

  if (!avatarUrl) {
    throw new Error('请选择头像')
  }

  await ensureNicknameUnique(nickname)

  const now = db.serverDate()
  const addRes = await db.collection('users').add({
    data: {
      nickname,
      avatar_url: avatarUrl,
      avatar_file_id: avatarUrl,
      avatar: avatarUrl,
      bio,
      profile_bg_url: '',
      is_certified: false,
      real_name: '',
      ich_category: '',
      workshop_id: '',
      draft_count: 0,
      stats: {
        ...DEFAULT_USER_STATS
      },
      create_time: now,
      update_time: now
    }
  })

  const createdUserRes = await db.collection('users').doc(addRes._id).get()

  return {
    success: true,
    existed: false,
    message: '注册成功',
    user: normalizeUserRecord(createdUserRes.data || {})
  }
}

async function updateProfile(event, openid) {
  if (!openid) {
    throw new Error('请先登录')
  }

  const currentUser = await getUserByOpenid(openid)
  if (!currentUser) {
    throw new Error('用户不存在，请重新登录后再试')
  }

  const nickname = validateNickname(event.nickname)
  const avatarUrl = getSafeString(event.avatar_url || event.avatar_file_id || event.avatar)
  const backgroundUrl = getSafeString(event.profile_bg_url)
  const bio = validateBio(event.bio || '')

  if (!avatarUrl) {
    throw new Error('请上传个人头像')
  }

  await ensureNicknameUnique(nickname, {
    excludeUserId: currentUser._id,
    excludeOpenid: openid
  })

  await db.collection('users').doc(currentUser._id).update({
    data: {
      nickname,
      avatar_url: avatarUrl,
      avatar_file_id: avatarUrl,
      avatar: avatarUrl,
      bio,
      profile_bg_url: backgroundUrl,
      update_time: db.serverDate()
    }
  })

  const nextUserRes = await db.collection('users').doc(currentUser._id).get()

  return {
    success: true,
    message: '保存成功',
    user: normalizeUserRecord(nextUserRes.data || {})
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = getSafeString(event.action)

  try {
    switch (action) {
      case 'check_nickname':
        return await checkNickname(event, OPENID)
      case 'register':
        return await registerUser(event, OPENID)
      case 'update_profile':
        return await updateProfile(event, OPENID)
      default:
        return {
          success: false,
          message: '不支持的操作类型'
        }
    }
  } catch (err) {
    console.error('[manage_user_profile]', err)
    return {
      success: false,
      message: err.message || '用户资料操作失败'
    }
  }
}
