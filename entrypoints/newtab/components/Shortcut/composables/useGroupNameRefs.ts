import type ShortcutGroupName from '../components/ShortcutGroupName.vue'

export function useGroupNameRefs() {
  const groupNameRefs = new Map<string, InstanceType<typeof ShortcutGroupName>>()

  const setGroupNameRef = (groupId: string, el: unknown) => {
    if (el) groupNameRefs.set(groupId, el as InstanceType<typeof ShortcutGroupName>)
    else groupNameRefs.delete(groupId)
  }

  return { groupNameRefs, setGroupNameRef }
}
