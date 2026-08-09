import 'element-plus/dist/index.css'
import './styles.scss'

import ElementPlus from 'element-plus'
import { createApp } from 'vue'

import App from './App.vue'

createApp(App).use(ElementPlus).mount('#app')
