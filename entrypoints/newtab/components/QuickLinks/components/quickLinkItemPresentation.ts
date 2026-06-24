export interface QuickLinkItemPresentation {
  linkTarget: '_blank' | '_self'
  linkRel?: 'noopener noreferrer'
  iconTitleGap: string
  showPinnedIcon: boolean
  iconBorder: boolean
  showTitle: boolean
  titleWidth: string
  iconClass: string
  pinIconClass: string
}
