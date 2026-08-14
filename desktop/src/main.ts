import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
  console.error('VUE_ERROR', info, err && err.stack ? err.stack : String(err));
};

window.addEventListener('error', (event) => {
  console.error('WINDOW_ERROR', event.message, event.error && event.error.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('UNHANDLED_REJECTION', event.reason && event.reason.stack);
});

app.mount('#app');
