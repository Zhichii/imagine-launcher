from PySide6.QtWidgets import (QLabel, QPushButton, QHBoxLayout, QWidget, 
                             QVBoxLayout, QFrame, QGraphicsDropShadowEffect)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor

from core.font.font_pages_manager import FontPagesManager
from core.ui.white_combox import WhiteComboBox
from core.ui.button_white import WhiteButton
from core.ui.buttons_blue import Button
from core.ui.card_white import CardWhite
from core.log.log_manager import log
from core.utils.notif import Notification, NotificationType
from core.i18n import i18n

class MinecraftHomePage(QWidget):
    switch_page_requested = Signal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.font_manager = FontPagesManager()
        self.selected_version = None
        self.setup_ui()
        
        # 连接语言变更信号
        i18n.language_changed.connect(self.update_text)
        
    def setup_ui(self):
        # 创建主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(30, 30, 30, 30)
        main_layout.setSpacing(20)
        
        # 顶部区域 - 标题和启动按钮
        top_layout = QHBoxLayout()
        
        # 标题
        self.title_label = QLabel(i18n.get_text("minecraft_launcher", "| Imagine Launcher"))
        self.font_manager.apply_font(self.title_label, "title")
        self.title_label.setStyleSheet("""
            color: #1F2937;
            font-size: 28px;
            font-weight: 600;
            background: transparent;
        """)
        top_layout.addWidget(self.title_label)
        
        top_layout.addStretch()
        
        # 版本选择
        self.version_label = QLabel(i18n.get_text("game_version", "游戏版本:"))
        self.font_manager.apply_font(self.version_label, "normal")
        self.version_label.setStyleSheet("color: #555555; font-size: 15px; background: transparent;")
        top_layout.addWidget(self.version_label)
        
        self.version_combo = WhiteComboBox()
        self.version_combo.addItem("1.20.1", "1.20.1")
        self.version_combo.addItem("1.19.4", "1.19.4")
        self.version_combo.addItem("1.18.2", "1.18.2")
        self.version_combo.addItem("1.16.5", "1.16.5")
        self.version_combo.setFixedWidth(150)
        top_layout.addWidget(self.version_combo)
        
        # 启动按钮 - 将Button替换为WhiteButton
        self.launch_button = WhiteButton(title=i18n.get_text("launch_game"), icon="play_arrow")
        self.launch_button.clicked.connect(self.launch_game)
        top_layout.addWidget(self.launch_button)
        
        main_layout.addLayout(top_layout)
        
        # 内容区域 - 简化为几个卡片
        self.cards_layout = QVBoxLayout()
        self.cards_layout.setSpacing(15)
        
        # 游戏信息卡片 - 使用actions=False参数隐藏社交按钮
        self.info_card = CardWhite(
            title=i18n.get_text("game_info", "游戏信息"),
            description=i18n.get_text("game_info_desc", "选择版本并点击启动按钮开始游戏。您可以前往其他页面管理版本或下载模组。"),
            actions=False
        )
        self.cards_layout.addWidget(self.info_card)
        
        # 快捷操作卡片 - 使用单独的框架
        operations_frame = QFrame()
        operations_frame.setObjectName("quickActionsFrame")
        operations_frame.setStyleSheet("""
            #quickActionsFrame {
                background: white;
                border-radius: 10px;
                border: 1px solid #E0E0E0;
            }
            #quickActionsFrame:hover {
                border: 1px solid #2196F3;
            }
        """)
        
        # 添加阴影效果
        shadow = QGraphicsDropShadowEffect(operations_frame)
        shadow.setBlurRadius(15)
        shadow.setColor(QColor(0, 0, 0, 25))
        shadow.setOffset(0, 2)
        operations_frame.setGraphicsEffect(shadow)
        
        operations_layout = QVBoxLayout(operations_frame)
        operations_layout.setContentsMargins(16, 12, 16, 12)
        operations_layout.setSpacing(8)
        
        # 操作卡片标题
        title_container = QHBoxLayout()
        title_container.setSpacing(8)
        
        # 添加右箭头装饰
        line_label = QLabel(self.font_manager.get_icon_text('chevron_right'))
        self.font_manager.apply_icon_font(line_label, size=18)
        line_label.setStyleSheet("color: #2196F3; background: transparent;")
        line_label.setFixedWidth(18)
        title_container.addWidget(line_label)
        
        # 标题文字
        self.quick_actions_label = QLabel(i18n.get_text("quick_actions", "快捷操作"))
        self.font_manager.apply_font(self.quick_actions_label, "normal")
        self.quick_actions_label.setStyleSheet("""
            color: #333333;
            font-weight: 500;
            background: transparent;
            padding: 0px;
            letter-spacing: 0.3px;
        """)
        title_container.addWidget(self.quick_actions_label)
        title_container.addStretch()
        
        # 描述文字
        self.quick_actions_desc = QLabel(i18n.get_text("quick_actions_desc", "使用下方按钮快速进入功能页面。"))
        self.font_manager.apply_font(self.quick_actions_desc, "normal")
        self.quick_actions_desc.setStyleSheet("""
            color: #666666;
            background: transparent;
            padding: 0px 0px 0px 26px;
            letter-spacing: 0.3px;
        """)
        self.quick_actions_desc.setWordWrap(True)
        
        # 按钮布局
        buttons_layout = QHBoxLayout()
        buttons_layout.setContentsMargins(26, 8, 0, 0)
        buttons_layout.setSpacing(10)
        
        # 版本管理按钮
        self.version_button = WhiteButton(title=i18n.get_text("version_management", "版本管理"), icon="cloud_download")
        self.version_button.clicked.connect(lambda: self.navigate_to("version_page"))
        buttons_layout.addWidget(self.version_button)
        
        # 模组管理按钮
        self.mods_button = WhiteButton(title=i18n.get_text("mod_management", "模组管理"), icon="extension")
        self.mods_button.clicked.connect(lambda: self.navigate_to("mods_page"))
        buttons_layout.addWidget(self.mods_button)
        
        # 设置按钮
        self.settings_button = WhiteButton(title=i18n.get_text("settings", "设置"), icon="settings")
        self.settings_button.clicked.connect(lambda: self.navigate_to("settings_page"))
        buttons_layout.addWidget(self.settings_button)
        
        # 游戏目录按钮
        self.folder_button = WhiteButton(title=i18n.get_text("game_directory", "游戏目录"), icon="folder_open")
        self.folder_button.clicked.connect(self.open_game_folder)
        buttons_layout.addWidget(self.folder_button)
        
        buttons_layout.addStretch()
        
        # 添加所有元素到操作卡片布局
        operations_layout.addLayout(title_container)
        operations_layout.addWidget(self.quick_actions_desc)
        operations_layout.addLayout(buttons_layout)
        
        self.cards_layout.addWidget(operations_frame)
        
        # 添加启动状态卡片 - 使用actions=False参数隐藏社交按钮
        self.status_card = CardWhite(
            title=i18n.get_text("launch_status", "启动状态"),
            description=i18n.get_text("ready", "就绪"),
            actions=False
        )
        self.cards_layout.addWidget(self.status_card)
        
        self.cards_layout.addStretch()
        main_layout.addLayout(self.cards_layout)
        
        # 设置整体样式
        self.setStyleSheet("""
            QWidget {
                background: #F8F9FA;
            }
            QLabel {
                border: none;
                background: transparent;
            }
        """)
    
    def launch_game(self):
        selected_version = self.version_combo.currentData()
        log.info(f"启动游戏版本: {selected_version}")
        
        # 显示通知
        Notification(
            text=i18n.get_text("launching_minecraft", "正在启动 Minecraft") + f" {selected_version}",
            type=NotificationType.INFO,
            duration=3000
        ).show_notification()
    
    def navigate_to(self, page_name):
        log.info(f"导航到页面: {page_name}")
        self.switch_page_requested.emit(page_name)
        
        # 显示通知
        page_names = {
            "version_page": i18n.get_text("version_management", "版本管理"),
            "mods_page": i18n.get_text("mod_management", "模组管理"),
            "settings_page": i18n.get_text("settings", "设置")
        }
        
        page_display_name = page_names.get(page_name, page_name)
        
        Notification(
            text=i18n.get_text("navigating_to", "正在跳转到") + f"{page_display_name}" + 
                 i18n.get_text("page_suffix", "页面"),
            type=NotificationType.INFO,
            duration=2000
        ).show_notification()
    
    def open_game_folder(self):
        log.info("打开游戏文件夹")
        
        # 显示通知
        Notification(
            text=i18n.get_text("opening_game_folder", "正在打开游戏文件夹"),
            type=NotificationType.TIPS,
            duration=2000
        ).show_notification()
    
    def update_text(self):
        """更新页面文本以响应语言变更"""
        try:
            # 更新标题和标签
            self.title_label.setText(i18n.get_text("minecraft_launcher", "Imagine Launcher"))
            self.version_label.setText(i18n.get_text("game_version", "游戏版本:"))
            
            # 使用update_title方法更新启动按钮的文本
            self.launch_button.update_title(i18n.get_text("launch_game", "启动游戏"))
            
            # 更新卡片内容 - 由于CardWhite没有set_title方法，我们需要重新创建这些卡片
            # 保存原始卡片的索引位置
            info_card_index = self.cards_layout.indexOf(self.info_card)
            status_card_index = self.cards_layout.indexOf(self.status_card)
            
            # 移除旧卡片
            self.cards_layout.removeWidget(self.info_card)
            self.info_card.deleteLater()
            self.cards_layout.removeWidget(self.status_card)
            self.status_card.deleteLater()
            
            # 创建新的卡片
            self.info_card = CardWhite(
                title=i18n.get_text("game_info", "游戏信息"),
                description=i18n.get_text("game_info_desc", "选择版本并点击启动按钮开始游戏。您可以前往其他页面管理版本或下载模组。"),
                actions=False
            )
            
            self.status_card = CardWhite(
                title=i18n.get_text("launch_status", "启动状态"),
                description=i18n.get_text("ready", "就绪"),
                actions=False
            )
            
            # 按照原来的顺序插入新卡片
            self.cards_layout.insertWidget(info_card_index, self.info_card)
            self.cards_layout.insertWidget(status_card_index, self.status_card)
            
            # 更新快捷操作卡片
            self.quick_actions_label.setText(i18n.get_text("quick_actions", "快捷操作"))
            self.quick_actions_desc.setText(i18n.get_text("quick_actions_desc", "使用下方按钮快速进入功能页面。"))
            
            # 由于WhiteButton有update_title方法，我们可以直接更新按钮文本而不用重建
            self.version_button.update_title(i18n.get_text("version_management", "版本管理"))
            self.mods_button.update_title(i18n.get_text("mod_management", "模组管理"))
            self.settings_button.update_title(i18n.get_text("settings", "设置"))
            self.folder_button.update_title(i18n.get_text("game_directory", "游戏目录"))
            
        except Exception as e:
            log.error(f"更新页面文本时出错: {str(e)}") 