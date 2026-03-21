const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { postId } = event

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!postId) {
    return { success: false, message: '参数错误：缺少帖子ID' }
  }

  try {
    // ========== 1. 查询帖子并校验权限 ==========
    const postRes = await db.collection('community_posts').doc(postId).get()

    if (!postRes.data) {
      return { success: false, message: '帖子不存在' }
    }

    const post = postRes.data

    if (post._openid !== openid) {
      console.warn(`[安全警告] 用户 ${openid} 尝试删除他人帖子 ${postId}`)
      return { success: false, message: '无权删除他人帖子' }
    }

    console.log(`[删除帖子] 开始三步管线删除帖子 ${postId}`)

    // ========== STEP 1：清理 Dify 知识库 ==========
    if (post.dify_doc_id) {
      try {
        await cloud.callFunction({
          name: 'sync_dify_knowledge',
          data: { post_id: postId, action: 'delete' }
        })
        console.log(`[STEP1] Dify 文档已删除`)
      } catch (syncErr) {
        console.warn(`[STEP1] Dify 删除失败(继续执行):`, syncErr.message || syncErr)
      }
    } else {
      console.log(`[STEP1] 无 dify_doc_id，跳过`)
    }

    // ========== STEP 2：清理云存储图片（必须 await，防资损）==========
    const fileIdsToDelete = []
    if (post.images && post.images.length > 0) {
      post.images.forEach(img => {
        const url = typeof img === 'string' ? img : (img.url || '')
        if (url.startsWith('cloud://')) {
          fileIdsToDelete.push(url)
        }
      })
    }

    if (fileIdsToDelete.length > 0) {
      try {
        await cloud.deleteFile({ fileList: fileIdsToDelete })
        console.log(`[STEP2] 已删除 ${fileIdsToDelete.length} 个云存储文件`)
      } catch (fileErr) {
        console.warn(`[STEP2] 云存储删除失败(继续执行):`, fileErr.message || fileErr)
      }
    } else {
      console.log(`[STEP2] 无云存储文件需要清理`)
    }

    // ========== STEP 3：清理数据库（话题计数 + 关联数据 + 帖子本体）==========

    // 3.1 话题计数减一（仅公开帖子）
    const tags = post.tags || []
    const isPublic = !post.status || post.status === 0
    if (tags.length > 0 && isPublic) {
      await decreaseTopicCounts(tags)
    }

    // 3.2 查询关联评论 ID
    const commentsRes = await db.collection('community_comments')
      .where({ post_id: postId })
      .field({ _id: true })
      .get()
    const commentIds = (commentsRes.data || []).map(c => c._id)

    // 3.3 并行清理所有关联数据
    const cleanupPromises = []

    if (commentIds.length > 0) {
      cleanupPromises.push(
        db.collection('community_comment_likes')
          .where({ comment_id: _.in(commentIds) })
          .remove()
          .catch(err => console.warn('[清理] 评论点赞删除失败:', err))
      )
    }

    cleanupPromises.push(
      db.collection('community_post_likes')
        .where({ target_id: postId })
        .remove()
        .catch(err => console.warn('[清理] 帖子点赞删除失败:', err))
    )

    cleanupPromises.push(
      db.collection('community_collections')
        .where({ post_id: postId })
        .remove()
        .catch(err => console.warn('[清理] 收藏删除失败:', err))
    )

    cleanupPromises.push(
      db.collection('community_reports')
        .where({ target_id: postId })
        .remove()
        .catch(err => console.warn('[清理] 举报删除失败:', err))
    )

    cleanupPromises.push(
      db.collection('community_comments')
        .where({ post_id: postId })
        .remove()
        .catch(err => console.warn('[清理] 评论删除失败:', err))
    )

    await Promise.all(cleanupPromises)

    // 3.4 最终删除帖子本体
    await db.collection('community_posts').doc(postId).remove()
    console.log(`[STEP3] 帖子 ${postId} 及所有关联数据已清理`)

    return {
      success: true,
      message: '删除成功',
      deletedComments: commentIds.length
    }

  } catch (err) {
    console.error('[删除帖子失败]', err)
    return {
      success: false,
      message: `删除失败: ${err.message || '未知错误'}`
    }
  }
}

async function decreaseTopicCounts(tags) {
  for (const tagName of tags) {
    try {
      const topicRes = await db.collection('community_topics')
        .where({ name: tagName })
        .get()

      if (topicRes.data && topicRes.data.length > 0) {
        const currentCount = topicRes.data[0].count || 0
        if (currentCount <= 1) {
          await db.collection('community_topics')
            .where({ name: tagName })
            .update({ data: { count: 0 } })
        } else {
          await db.collection('community_topics')
            .where({ name: tagName })
            .update({ data: { count: _.inc(-1) } })
        }
      }
    } catch (err) {
      console.warn(`[话题] 减少 ${tagName} 计数失败:`, err)
    }
  }
}
