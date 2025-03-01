from PySide6.QtWidgets import (QWidget, QVBoxLayout, QLabel, 
                             QHBoxLayout, QScrollArea, QFrame, QSpacerItem, QSizePolicy,
                             QGraphicsDropShadowEffect)
from PySide6.QtCore import Qt, QUrl, QTimer
from PySide6.QtGui import QDesktopServices, QPixmap, QColor
from core.ui.button_white import WhiteButton
from core.font.font_pages_manager import FontPagesManager
from core.utils.notif import NotificationType
from core.log.log_manager import log
from core.ui.scroll_style import ScrollStyle
from core.animations.scroll_hide_show import ScrollBarAnimation
from core.font.font_manager import resource_path
from core.i18n import i18n
import os

class AboutPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.font_manager = FontPagesManager()
        
        # 创建主布局
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        self.setup_ui()
        
        # 连接语言变更信号
        i18n.language_changed.connect(self.update_text)
        
    def setup_ui(self):
        # 清除现有布局（如果有）
        if hasattr(self, 'scroll_container'):
            self.layout.removeWidget(self.scroll_container)
            self.scroll_container.deleteLater()
        
        # 创建一个容器来包裹滚动区域
        self.scroll_container = QWidget()
        self.scroll_container.setObjectName("scrollContainer")
        scroll_container_layout = QVBoxLayout(self.scroll_container)
        scroll_container_layout.setContentsMargins(0, 0, 0, 0)
        
        # 设置全局样式
        self.setStyleSheet("""
            QWidget#scrollContainer {
                background: transparent;
                margin: 0px 20px;
            }
            
            QScrollArea#scrollArea {
                background: transparent;
                border: none;
            }
            
            QWidget#container {
                background: transparent;
            }
            
            QLabel {
                color: #1F2937;
                background: transparent;
                font-size: 14px;
                letter-spacing: 0.3px;
            }
            
            QLabel[class="title"] {
                font-size: 24px;
                font-weight: 600;
                color: #1F2937;
            }
            
            QLabel[class="subtitle"] {
                font-size: 18px;
                font-weight: 500;
                color: #2196F3;
            }
            
            QLabel[class="version"] {
                font-size: 13px;
                color: #666666;
            }
            
            QLabel[class="description"] {
                font-size: 14px;
                color: #666666;
                line-height: 1.6;
            }
            
            QLabel[class="copyright"] {
                font-size: 12px;
                color: #9E9E9E;
            }
            
            /* 自定义滚动条样式 */
            QScrollBar:vertical {{
                background: transparent;
                width: 8px;
                margin: 4px 4px 4px 4px;
            }}
            
            QScrollBar::handle:vertical {{
                background: #C0C0C0;
                border-radius: 4px;
                min-height: 30px;
            }}
            
            QScrollBar::handle:vertical:hover {{
                background: #A0A0A0;
            }}
            
            QScrollBar::add-line:vertical {{
                height: 0px;
            }}
            
            QScrollBar::sub-line:vertical {{
                height: 0px;
            }}
            
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
                background: transparent;
            }}
        """)
        
        # 设置滚动区域
        scroll_area = QScrollArea()
        self.scroll_area = scroll_area
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll_area.setObjectName("scrollArea")
        
        # 应用滚动条样式
        ScrollStyle.apply_to_widget(scroll_area)
        
        # 设置滚动条动画
        self.scroll_animation = ScrollBarAnimation(scroll_area.verticalScrollBar())
        
        # 连接滚动条值改变信号
        scroll_area.verticalScrollBar().valueChanged.connect(
            self.scroll_animation.show_temporarily
        )
        
        # 内容容器
        container = QWidget()
        container.setObjectName("container")
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(40, 40, 40, 40)
        container_layout.setSpacing(30)
        
        # 标题部分 - "关于"
        about_title = QLabel(i18n.get_text("about"))
        self.font_manager.apply_title_style(about_title)
        about_title.setProperty("class", "title")
        container_layout.addWidget(about_title)
        
        # 创建蓝色卡片
        blue_card = QFrame()
        blue_card.setObjectName("blueCard")
        blue_card.setStyleSheet("""
            QFrame#blueCard {
                background-color: #0D3B66;
                border-radius: 12px;
                color: white;
            }
        """)
        
        # 添加阴影效果
        shadow = QGraphicsDropShadowEffect(blue_card)
        shadow.setBlurRadius(15)
        shadow.setColor(QColor(0, 0, 0, 40))
        shadow.setOffset(0, 1)
        blue_card.setGraphicsEffect(shadow)
        
        blue_card_layout = QVBoxLayout(blue_card)
        blue_card_layout.setContentsMargins(20, 20, 20, 20)
        blue_card_layout.setSpacing(10)
        
        # 顶部布局（Logo和信息）
        top_layout = QHBoxLayout()
        top_layout.setSpacing(15)
        
        # Logo区域
        logo_path = resource_path(os.path.join("resources", "logo.png"))
        try:
            logo_container = QFrame()
            logo_container.setFixedSize(150, 70)
            logo_container.setStyleSheet("""
                QFrame {
                    background-color: #0A2F52;
                    border-radius: 8px;
                }
            """)
            
            logo_layout = QVBoxLayout(logo_container)
            logo_layout.setContentsMargins(10, 5, 10, 5)
            logo_layout.setAlignment(Qt.AlignCenter)
            
            logo_label = QLabel()
            logo_pixmap = QPixmap(logo_path)
            if logo_pixmap.isNull():
                log.error(f"无法加载Logo图片: {logo_path}")
            else:
                scaled_pixmap = logo_pixmap.scaled(130, 60, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                logo_label.setPixmap(scaled_pixmap)
                logo_label.setAlignment(Qt.AlignCenter)
            
            logo_layout.addWidget(logo_label)
            top_layout.addWidget(logo_container)
        except Exception as e:
            log.error(f"加载Logo时出错: {str(e)}")
        
        # 信息区域
        info_layout = QVBoxLayout()
        info_layout.setSpacing(5)
        
        title_label = QLabel(i18n.get_text("launcher_app_name", "| Imagine Launcher"))
        title_label.setStyleSheet("color: white; font-size: 18px; font-weight: 600;")
        self.font_manager.apply_title_style(title_label)
        
        version_label = QLabel(i18n.get_text("launcher_version"))
        version_label.setStyleSheet("color: white; font-size: 14px; opacity: 0.8;")
        self.font_manager.apply_small_style(version_label)
        
        build_date_label = QLabel(i18n.get_text("launcher_build_date"))
        build_date_label.setStyleSheet("color: white; font-size: 14px; opacity: 0.8;")
        self.font_manager.apply_small_style(build_date_label)
        
        dev_info_label = QLabel(i18n.get_text("launcher_dev_info"))
        dev_info_label.setStyleSheet("color: white; font-size: 14px; opacity: 0.8;")
        self.font_manager.apply_small_style(dev_info_label)
        
        info_layout.addWidget(title_label)
        info_layout.addWidget(version_label)
        info_layout.addWidget(build_date_label)
        info_layout.addWidget(dev_info_label)
        info_layout.addStretch()
        
        top_layout.addLayout(info_layout)
        top_layout.addStretch()
        
        blue_card_layout.addLayout(top_layout)
        container_layout.addWidget(blue_card)
        
        # 创建白色卡片
        white_card = QFrame()
        white_card.setObjectName("whiteCard")
        white_card.setStyleSheet("""
            QFrame#whiteCard {
                background-color: white;
                border-radius: 12px;
                color: #333333;
            }
        """)
        
        # 添加阴影效果
        shadow2 = QGraphicsDropShadowEffect(white_card)
        shadow2.setBlurRadius(15)
        shadow2.setColor(QColor(0, 0, 0, 40))
        shadow2.setOffset(0, 1)
        white_card.setGraphicsEffect(shadow2)
        
        white_card_layout = QVBoxLayout(white_card)
        white_card_layout.setContentsMargins(20, 20, 20, 20)
        white_card_layout.setSpacing(15)
        
        # 顶部布局（Logo和信息）
        top_layout2 = QHBoxLayout()
        top_layout2.setSpacing(15)
        
        # Logo区域
        logo2_path = resource_path(os.path.join("resources", "logo2.png"))
        try:
            logo_container2 = QFrame()
            logo_container2.setFixedSize(150, 70)
            logo_container2.setStyleSheet("""
                QFrame {
                    background-color: #F5F5F5;
                    border-radius: 8px;
                }
            """)
            
            logo_layout2 = QVBoxLayout(logo_container2)
            logo_layout2.setContentsMargins(10, 5, 10, 5)
            logo_layout2.setAlignment(Qt.AlignCenter)
            
            logo_label2 = QLabel()
            logo_pixmap2 = QPixmap(logo2_path)
            if logo_pixmap2.isNull():
                log.error(f"无法加载Logo2图片: {logo2_path}")
            else:
                scaled_pixmap2 = logo_pixmap2.scaled(130, 60, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                logo_label2.setPixmap(scaled_pixmap2)
                logo_label2.setAlignment(Qt.AlignCenter)
            
            logo_layout2.addWidget(logo_label2)
            top_layout2.addWidget(logo_container2)
        except Exception as e:
            log.error(f"加载Logo2时出错: {str(e)}")
        
        # 信息区域
        info_layout2 = QVBoxLayout()
        info_layout2.setSpacing(5)
        
        title_label2 = QLabel(i18n.get_text("ui_app_name", "| ClutUI Nextgen"))
        title_label2.setStyleSheet("color: #333333; font-size: 18px; font-weight: 600;")
        self.font_manager.apply_title_style(title_label2)
        
        version_label2 = QLabel(i18n.get_text("ui_version"))
        version_label2.setStyleSheet("color: #666666; font-size: 14px;")
        self.font_manager.apply_small_style(version_label2)
        
        related_info_label = QLabel(i18n.get_text("ui_related_info"))
        related_info_label.setStyleSheet("color: #666666; font-size: 14px;")
        self.font_manager.apply_small_style(related_info_label)
        
        info_layout2.addWidget(title_label2)
        info_layout2.addWidget(version_label2)
        info_layout2.addWidget(related_info_label)
        info_layout2.addStretch()
        
        top_layout2.addLayout(info_layout2)
        top_layout2.addStretch()
        
        white_card_layout.addLayout(top_layout2)
        
        # 链接按钮
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        button_layout.setContentsMargins(0, 5, 0, 0)
        
        # 创建一个水平布局来包含按钮和文本
        link_container = QHBoxLayout()
        link_container.setSpacing(5)
        link_container.setAlignment(Qt.AlignLeft)
        
        link_button = WhiteButton(title=i18n.get_text("link_button", "Github"), icon=self.font_manager.get_icon_text("link"))
        link_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(i18n.get_text("urls.project"))))
        
        link_container.addWidget(link_button)
        button_layout.addLayout(link_container)
        button_layout.addStretch()
        
        white_card_layout.addLayout(button_layout)
        
        container_layout.addWidget(white_card)
        
        # 免责声明文本
        disclaimer_text = QLabel(i18n.get_text("disclaimer_text"))
        disclaimer_text.setWordWrap(True)
        disclaimer_text.setAlignment(Qt.AlignLeft)
        disclaimer_text.setStyleSheet("color: #666666; font-size: 13px; line-height: 1.5;")
        self.font_manager.apply_small_style(disclaimer_text)
        container_layout.addWidget(disclaimer_text)
        
        # 按钮区域
        buttons_layout = QHBoxLayout()
        buttons_layout.setSpacing(15)
        
        # 按钮配置
        self.buttons_data = [
            ("changelog", i18n.get_text("urls.changelog"), "history"),
            ("documentation", i18n.get_text("urls.documentation"), "article"),
            ("source_code", i18n.get_text("urls.source_code"), "code"),
        ]
        
        self.main_buttons = []  # 存储主要按钮引用
        for key, url, icon in self.buttons_data:
            btn = WhiteButton(title=i18n.get_text(key), icon=self.font_manager.get_icon_text(icon))
            btn.clicked.connect(lambda u=url: QDesktopServices.openUrl(QUrl(u)))
            buttons_layout.addWidget(btn)
            self.main_buttons.append((key, btn))  # 保存按钮引用和对应的key
        
        buttons_layout.setAlignment(Qt.AlignCenter)
        container_layout.addLayout(buttons_layout)
        
        # 版权信息
        self.copyright = QLabel(i18n.get_text("copyright"))
        self.font_manager.apply_small_style(self.copyright)
        self.copyright.setAlignment(Qt.AlignCenter)
        self.copyright.setProperty("class", "copyright")
        container_layout.addWidget(self.copyright)
        
        container_layout.addStretch()
        
        # 设置滚动区域的内容
        scroll_area.setWidget(container)
        scroll_container_layout.addWidget(scroll_area)
        
        # 将滚动容器添加到主布局
        self.layout.addWidget(self.scroll_container)

    def show_notification(self):
        try:
            main_window = self.window()
            if main_window:
                main_window.show_notification(
                    text="Welcome Imagine Launcher",
                    type=NotificationType.TIPS,
                    duration=1000
                )
                log.debug("显示欢迎通知")
            else:
                log.error("未找到主窗口实例")
        except Exception as e:
            log.error(f"显示通知出错: {str(e)}")

    def update_text(self):
        # 更新所有文本内容
        try:
            # 重新设置UI以更新所有文本
            self.setup_ui()
        except Exception as e:
            log.error(f"更新文本时出错: {str(e)}")
