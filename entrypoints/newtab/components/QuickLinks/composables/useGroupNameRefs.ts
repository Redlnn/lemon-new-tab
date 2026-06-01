import type QuickLinkGroupName from '../components/QuickLinkGroupName.vue'

export function useGroupNameRefs() {
  const groupNameRefs = new Map<string, InstanceType<typeof QuickLinkGroupName>>()

  const setGroupNameRef = (groupId: string, el: unknown) => {
    if (el) groupNameRefs.set(groupId, el as InstanceType<typeof QuickLinkGroupName>)
    else groupNameRefs.delete(groupId)
  }

  return { groupNameRefs, setGroupNameRef }
}
