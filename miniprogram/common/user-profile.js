const DEFAULT_USER_STATS = {
  following: 0,
  followers: 0,
  likes: 0,
  views: 0
}

const DEFAULT_USER_PROFILE = {
  nickname: '',
  avatar_url: '',
  avatar_file_id: '',
  avatar: '',
  bio: '',
  profile_bg_url: '',
  is_certified: false,
  real_name: '',
  ich_category: '',
  workshop_id: '',
  draft_count: 0,
  stats: DEFAULT_USER_STATS
}

function cloneDefaultStats() {
  return { ...DEFAULT_USER_STATS }
}

function createDefaultUserProfile() {
  return {
    ...DEFAULT_USER_PROFILE,
    stats: cloneDefaultStats()
  }
}

function normalizeUserProfile(userInfo = {}) {
  const normalized = {
    ...createDefaultUserProfile(),
    ...(userInfo || {})
  }

  normalized.stats = {
    ...cloneDefaultStats(),
    ...((userInfo && userInfo.stats) || {})
  }

  if (!normalized.avatar_file_id && normalized.avatar_url) {
    normalized.avatar_file_id = normalized.avatar_url
  }
  if (!normalized.avatar && normalized.avatar_url) {
    normalized.avatar = normalized.avatar_url
  }

  normalized.nickname = String(normalized.nickname || '')
  normalized.avatar_url = String(normalized.avatar_url || '')
  normalized.avatar_file_id = String(normalized.avatar_file_id || '')
  normalized.avatar = String(normalized.avatar || '')
  normalized.bio = String(normalized.bio || '')
  normalized.profile_bg_url = String(normalized.profile_bg_url || '')
  normalized.real_name = String(normalized.real_name || '')
  normalized.ich_category = String(normalized.ich_category || '')
  normalized.workshop_id = String(normalized.workshop_id || '')
  normalized.draft_count = Number(normalized.draft_count) || 0
  normalized.is_certified = Boolean(normalized.is_certified)
  normalized.stats.following = Number(normalized.stats.following) || 0
  normalized.stats.followers = Number(normalized.stats.followers) || 0
  normalized.stats.likes = Number(normalized.stats.likes) || 0
  normalized.stats.views = Number(normalized.stats.views) || 0

  return normalized
}

function getMissingUserProfilePatch(userInfo = {}) {
  const patch = {}
  const source = userInfo || {}

  Object.keys(DEFAULT_USER_PROFILE).forEach((key) => {
    if (key === 'stats') return
    if (!(key in source) || source[key] === undefined) {
      patch[key] = DEFAULT_USER_PROFILE[key]
    }
  })

  const statsSource = source.stats
  if (!statsSource || typeof statsSource !== 'object' || Array.isArray(statsSource)) {
    patch.stats = cloneDefaultStats()
  } else {
    const statsPatch = {}
    Object.keys(DEFAULT_USER_STATS).forEach((key) => {
      if (!(key in statsSource) || statsSource[key] === undefined) {
        statsPatch[key] = DEFAULT_USER_STATS[key]
      }
    })
    if (Object.keys(statsPatch).length) {
      patch.stats = {
        ...cloneDefaultStats(),
        ...statsSource,
        ...statsPatch
      }
    }
  }

  return patch
}

module.exports = {
  DEFAULT_USER_PROFILE,
  DEFAULT_USER_STATS,
  createDefaultUserProfile,
  normalizeUserProfile,
  getMissingUserProfilePatch
}
