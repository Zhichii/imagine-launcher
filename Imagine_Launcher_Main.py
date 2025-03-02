'''
入口程序
'''
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout
from PySide6.QtCore import Qt, QTimer, QSize
from PySide6.QtGui import QIcon, QWindow
from core.utils.initialization_manager import InitializationManager
from core.log.log_manager import log
from core.utils.notif import Notification, NotificationType
from core.ui.title_bar import TitleBar
from core.window.window_manager import WindowManager
from core.i18n import i18n
from core.pages_core.pages_effect import PagesEffect
from core.utils.resource_manager import ResourceManager
from core.utils.yiyanapi import YiyanAPI
import sys
import os
import json
import ctypes
import win32gui
import win32con
import win32api
from PIL import Image
import tempfile

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        
        InitializationManager.init_log_directory()
        InitializationManager.init_window_components(self)
        log.info(i18n.get_text("init_window"))
        
        # 设置应用图标
        resource_manager = ResourceManager()
        icon = resource_manager.get_icon("logo_256")# logo 256 fix 
        if icon:
            # 设置窗口图标
            self.setWindowIcon(icon)
            QApplication.setWindowIcon(icon)
            
            # 设置任务栏图标
            if os.name == 'nt':  # Windows系统
                try:
                    # 获取窗口句柄
                    hwnd = self.winId().__int__()
                    
                    # 加载图标文件
                    
                    icon_path = resource_manager.get_resource_path(os.path.join("resources", "logo.ico"))
                    if not os.path.exists(icon_path):
                        # 如果没有ico文件，尝试使用png
                        icon_path = resource_manager.get_resource_path(os.path.join("resources", "logo.png"))
                    
                    if os.path.exists(icon_path):
                        # 设置应用程序ID
                        app_id = "Imagine.Launcher.ClutUI.Nextgen"
                        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
                        
                        # 创建临时ICO文件
                        with tempfile.NamedTemporaryFile(suffix='.ico', delete=False) as temp_ico:
                            temp_ico_path = temp_ico.name
                        
                        # 使用原始logo图标
                        img = Image.open(icon_path)
                        
                        # 更强的图标缩放和优化处理
                        try:
                            # 创建一个透明底色的正方形画布
                            size = 256
                            new_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
                            
                            # 大幅缩小图标尺寸到40%，使其在任务栏上更清晰
                            width, height = img.size
                            scale_factor = min(size * 0.4 / width, size * 0.4 / height)
                            new_width = int(width * scale_factor)
                            new_height = int(height * scale_factor)
                            
                            # 使用高质量缩放
                            resized_img = img.resize((new_width, new_height), Image.LANCZOS)
                            
                            # 居中定位，留出充足边距
                            left = (size - new_width) // 2
                            top = (size - new_height) // 2
                            
                            # 粘贴到主画布
                            new_img.paste(resized_img, (left, top), resized_img if resized_img.mode == 'RGBA' else None)
                            
                            # 准备各种尺寸的图标
                            small_images = []
                            sizes = []
                            
                            # 为任务栏生成特定尺寸的图标
                            for s in [16, 24, 32, 48, 64]:
                                # 为每个尺寸创建新画布
                                small_canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
                                
                                # 计算超小图标尺寸（只占画布的50%）
                                small_width = int(s * 0.5)
                                small_height = int(small_width * height / width) if width > 0 else small_width
                                
                                # 计算居中位置
                                small_left = (s - small_width) // 2
                                small_top = (s - small_height) // 2
                                
                                # 单独处理每个尺寸，确保最佳效果
                                small_icon = img.resize((small_width, small_height), Image.LANCZOS)
                                small_canvas.paste(small_icon, (small_left, small_top), small_icon if small_icon.mode == 'RGBA' else None)
                                
                                # 添加到图标列表
                                small_images.append(small_canvas)
                                sizes.append((s, s))
                            
                            # 正确保存多尺寸ICO文件
                            new_img.save(temp_ico_path, format='ICO', sizes=sizes, append_images=small_images)
                            
                            # 加载ICO文件
                            icon_handle = win32gui.LoadImage(
                                0, temp_ico_path, win32con.IMAGE_ICON,
                                0, 0, win32con.LR_LOADFROMFILE | win32con.LR_DEFAULTSIZE
                            )
                            
                            # 设置窗口图标
                            win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_SMALL, icon_handle)
                            win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_BIG, icon_handle)
                            
                            # 清理临时文件
                            try:
                                os.unlink(temp_ico_path)
                            except:
                                pass
                            
                            log.info("成功使用更优化的临时ICO文件设置任务栏图标")
                        except Exception as e:
                            log.error(f"优化图标失败: {str(e)}")
                except Exception as e:
                    log.error(f"设置任务栏图标失败: {str(e)}")
            
            log.info("成功加载应用图标")
        
        # 设置窗口基本属性
        self.setWindowTitle(i18n.get_text("app_title", "Imagine Launcher"))
        self.setMinimumSize(600, 450)
        self.resize(1080, 650)
        
        # 设置窗口背景透明和无边框
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.Window)
        
        # 创建主窗口部件
        main_widget = QWidget()
        main_widget.setObjectName("mainWidget")
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # 先隐藏主窗口部件，避免初始化时的闪烁
        main_widget.hide()
        
        self.title_bar = TitleBar(self)
        self.title_bar.title_label.setText(i18n.get_text("app_title_full", "Imagine Launcher"))
        main_layout.addWidget(self.title_bar)
        
        # 创建内容区域容器
        content_container = QWidget()
        content_layout = QHBoxLayout(content_container)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)
        
        # 右侧内容区
        right_content = QWidget()
        self.right_layout = QVBoxLayout(right_content)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        
        # 创建页面容器
        self.page_container = QWidget()
        self.page_layout = QVBoxLayout(self.page_container)
        self.page_layout.setContentsMargins(0, 0, 0, 0)
        self.page_layout.addWidget(self.pages_manager.get_stacked_widget())
        self.right_layout.addWidget(self.page_container)
        
        # 将左右两侧添加到内容布局
        content_layout.addWidget(self.pages_manager.get_sidebar())
        content_layout.addWidget(right_content)
        
        # 将内容容器添加到主布局
        main_layout.addWidget(content_container)
        
        # 设置主窗口样式
        main_widget.setStyleSheet("""
            QWidget#mainWidget {
                background-color: #F8F9FA;
                border-radius: 10px;
                border: 1px solid #E0E0E0;
            }
        """)
        
        # 设置窗口属性以支持圆角
        self.setAttribute(Qt.WA_TranslucentBackground)
        
        self.setCentralWidget(main_widget)
        
        # 初始化关闭相关属性
        self._closing = False
        self._cleanup_timer = QTimer()
        self._cleanup_timer.setSingleShot(True)
        self._cleanup_timer.timeout.connect(self._finish_close)
        self._notifications = []
        
        # 连接语言变更信号
        i18n.language_changed.connect(self._on_language_changed)
        
        # 预先应用一次模糊效果
        PagesEffect.apply_blur_effect(self)
        
        # 使用QTimer延迟应用背景效果并显示窗口
        QTimer.singleShot(50, self._init_background_effect)
        
        # 异步加载一言并显示欢迎通知
        self._show_welcome_notification()

    def _show_welcome_notification(self):
        self.yiyan_api = YiyanAPI()
        # 连接信号
        self.yiyan_api.hitokoto_ready.connect(
            lambda text: self.show_notification(
                text=text,
                type=NotificationType.TIPS,
                duration=3000
            )
        )
        # 开始异步获取
        initial_text = self.yiyan_api.get_hitokoto_async()
        # 显示初始通知
        self.show_notification(
            text=initial_text,
            type=NotificationType.TIPS,
            duration=3000
        )

    def _init_background_effect(self):
        try:
            with open('config.json', 'r') as f:
                config = json.loads(f.read())
                effect = config.get('background_effect', 'effect_none')
                
                if effect == 'effect_none':
                    PagesEffect.remove_effects(self)
                elif effect == 'effect_mica':
                    PagesEffect.apply_mica_effect(self)
                elif effect == 'effect_gaussian':
                    PagesEffect.apply_gaussian_blur(self)
                elif effect == 'effect_blur':
                    PagesEffect.apply_blur_effect(self)
                elif effect == 'effect_acrylic':
                    PagesEffect.apply_acrylic_effect(self)
                elif effect == 'effect_aero':
                    PagesEffect.apply_aero_effect(self)
                else:
                    # 未知效果，使用默认模糊效果
                    PagesEffect.apply_blur_effect(self)
        except Exception as e:
            # 如果配置读取失败，默认使用无效果
            log.error(f"应用背景效果时出错: {str(e)}")
            PagesEffect.remove_effects(self)
        
        # 显示主窗口部件
        self.centralWidget().show()

    def _apply_saved_background_effect(self):
        self._init_background_effect()

    def _on_language_changed(self, lang=None):
        self.setWindowTitle(i18n.get_text("app_title", "Imagine Launcher"))
        self.title_bar.title_label.setText(i18n.get_text("app_title_full", "Imagine Launcher"))
        # 通知页面管理器更新所有页面的文本
        self.pages_manager.update_all_pages_text()

    def _finish_close(self):
        WindowManager.finish_close(self)
        # 断开信号连接
        try:
            i18n.language_changed.disconnect(self._on_language_changed)
        except:
            pass

    def closeEvent(self, event):
        WindowManager.handle_close_event(self, event)

    def switch_page(self, page_name):
        WindowManager.switch_page(self, page_name)

    def show_notification(self, text, type=NotificationType.TIPS, duration=1000):
        notification = Notification(
            text=text,
            type=type,
            duration=duration,
            parent=self
        )
        self._notifications.append(notification)
        notification.animation_finished.connect(
            lambda: self._notifications.remove(notification) if notification in self._notifications else None
        )
        notification.show_notification()

if __name__ == '__main__':
    try:
        app = InitializationManager.init_application()
        window = MainWindow()
        window.show()
        log.info(i18n.get_text("app_started"))
        
        exit_code = app.exec()
        sys.exit(exit_code)
        
    except Exception as e:
        log.error(f"{i18n.get_text('app_error')}: {str(e)}")
        sys.exit(1)

