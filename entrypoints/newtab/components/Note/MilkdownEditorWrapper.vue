<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'

import MilkdownEditor from './MilkdownEditor.vue'

const content = defineModel<string>('content', { default: '' })
const readonly = defineModel<boolean>('readonly', { default: false })
</script>

<template>
  <MilkdownProvider>
    <MilkdownEditor v-model:content="content" v-model:readonly="readonly" />
  </MilkdownProvider>
</template>

<style lang="css">
.milkdown {
  --crepe-font-default: var(--el-font-family);
  --crepe-font-title: var(--el-font-family);
}

.milkdown .milkdown-top-bar {
  min-height: 34px;
}

.milkdown .milkdown-top-bar .top-bar-heading-selector {
  padding: 0;
}

.milkdown .milkdown-top-bar .top-bar-divider {
  height: 14px;
}

.note-content-container > div[data-milkdown-root] {
  height: 100%;
  min-height: 0;
}

.note-content-container .milkdown {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background-color: #fefcf7;

  .milkdown-top-bar {
    flex-grow: 0;
    flex-shrink: 0;
  }
}

.note-content-container .milkdown .milkdown-top-bar .top-bar-item {
  width: 24px;
  height: 24px;
  padding: 6px;
  margin: 2px;

  svg {
    width: 20px;
    height: 20px;
  }
}

.note-editor-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
}

.note-editor-corner {
  position: absolute;
  display: block;
  width: 8px;
  height: 8px;
  position-anchor: --editor;
  background-color: #fefcf7;
  border: solid 2px #e9e5d9;

  &[data-index='1'] {
    bottom: calc(anchor(bottom) + 79px);
    left: calc(anchor(left) + 19px);
  }

  &[data-index='2'] {
    top: calc(anchor(top) + 19px);
    left: calc(anchor(left) + 19px);
  }

  &[data-index='3'] {
    right: calc(anchor(right) + 19px);
    bottom: calc(anchor(bottom) + 79px);
  }

  &[data-index='4'] {
    top: calc(anchor(top) + 19px);
    right: calc(anchor(right) + 19px);
  }
}

.note-content-container .milkdown .editor {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  padding: 70px 60px 150px;
  anchor-name: --editor;
  overflow-x: hidden;
  color: #625649;
}

.note-content-container .milkdown .editor::before {
  position: absolute;
  inset: 25px 25px 85px;
  pointer-events: none;
  content: '';

  border: 7px double #e9e5d9;
}

.note-editor-frame .ProseMirror a {
  color: #ac9070;
}

.note-editor-frame .ProseMirror blockquote {
  color: #b4a08e;
  background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA4hpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTMyIDc5LjE1OTI4NCwgMjAxNi8wNC8xOS0xMzoxMzo0MCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDo4MTE5MThmNC1lYjM0LTRmMTAtOThlMS0wNGU5NTczZTVkOGQiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6MTk1NTJCQzE4NTRGMTFFNkJCNjdCRTNENzMyQzJFNTkiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6MTk1NTJCQzA4NTRGMTFFNkJCNjdCRTNENzMyQzJFNTkiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTUuNSAoTWFjaW50b3NoKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjQzMTkyM2NmLTYyZWEtNDAwNS1iNDg2LTdhYjllNDQ0MjM5OSIgc3RSZWY6ZG9jdW1lbnRJRD0iYWRvYmU6ZG9jaWQ6cGhvdG9zaG9wOjkzOTdhMDhkLWE2NjUtMTE3OS1hZWYxLWE1MjY4MTQ3ZGEyNyIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PkOrP8kAAADUSURBVHjaYiwJ02CgJmCiUB4dsLDgMEQYirmA+BwBQ5iBWAyIhYCYA91AXiBWAGI2Il0kAMRyQMwKdyKSpBDUMEYiDQO5ShZXGHGTaBgvNsOQXYjNsF9A/AKLHkaoenTwE6QeZKAgKDDRJD8D8V0g/otFoxCWMP4IxPeA+B8T1EBk8Bcq+ReHd4XQ+H+A+D7IMFgY8qApeA9VhAtwYVH/FzlS0JPOFwIJHa96FiyR8Q+aWJGDADlCGPCpx5ZTlND4ZwkkIWVK8irFhcOogcPBQIAAAwA1ph0Za5PfQwAAAABJRU5ErkJggg==');
  background-repeat: no-repeat;
  background-position: 0 0;
  background-size: 13px;

  &::before {
    display: none;
  }
}

.note-editor-frame .ProseMirror .milkdown-code-block {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  background: #282c34;
  border: 1px #ebdfd5 solid;

  .tools .language-button {
    margin-bottom: 0;
  }
}

.note-editor-frame .ProseMirror code,
.note-editor-frame .ProseMirror pre {
  --crepe-color-inline-code: #6b5e4f;
  padding: 2px 5px;
  vertical-align: middle;
  background-color: #f3eee4;
  border-radius: 8px;
}

.note-editor-frame .ProseMirror pre {
  padding: 10px 15px;
  overflow-x: scroll;
  white-space: pre;
}

.note-editor-footer {
  position: absolute;
  bottom: calc(anchor(bottom) + 55px);
  left: calc(anchor(left) + 35px);
  display: flex;
  align-items: center;
  position-anchor: --editor;
  font-size: 14px;
  color: #d1cec5;
  user-select: none;

  img {
    height: 18px;
    margin-right: 8px;
  }

  .note-editor-footer__subtitle {
    margin-left: 10px;
    font-size: 11px;
    font-weight: 300;
  }
}
</style>
