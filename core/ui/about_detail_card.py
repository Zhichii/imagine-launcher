from PySide6.QtWidgets import (QFrame, QLabel, QVBoxLayout, QGraphicsDropShadowEffect, 
                             QHBoxLayout, QWidget, QPushButton, QSizePolicy)
from PySide6.QtCore import Qt, Signal, QUrl
from PySide6.QtGui import QColor, QPixmap, QDesktopServices
from core.font.font_manager import FontManager
from core.font.font_pages_manager import FontPagesManager
from core.ui.card_shadow import CardShadow
from core.ui.button_white import WhiteButton
from core.i18n import i18n
from core.log.log_manager import log

class AboutDetailCard(QFrame):
    
    def __init__(self, title="", version="", related_info="", link_text="", link_url="", logo_path=None, parent=None):
        super().__init__(parent)
        self.title = title
        self.version = version
        self.related_info = related_info
        self.link_text = link_text
        self.link_url = link_url
        self.logo_path = logo_path
        
        self.font_manager = FontManager()
        self.font_pages_manager = FontPagesManager()
        
        # 创建UI组件引用
        self.title_label = None
        self.version_label = None
        self.related_info_label = None
        self.link_button = None
        self.main_layout = None
        
        self.setup_ui()
        
        # 连接语言变更信号
        i18n.language_changed.connect(self.update_text)
        
    def setup_ui(self):
        # 设置卡片样式
        self.setStyleSheet("""
            AboutDetailCard {
                background-color: white;
                border-radius: 12px;
                color: #333333;
            }
            QLabel {
                color: #333333;
                background: transparent;
            }
            QLabel[class="title"] {
                font-size: 18px;
                font-weight: 600;
            }
            QLabel[class="version"] {
                font-size: 14px;
                color: #666666;
            }
            QLabel[class="related-info"] {
                font-size: 14px;
                color: #666666;
            }
        """)
        
        # 添加阴影效果
        shadow = CardShadow.get_shadow(self)
        self.setGraphicsEffect(shadow)
        
        # 清除现有布局（如果有）
        if self.layout():
            # 删除旧布局中的所有项目
            while self.layout().count():
                item = self.layout().takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            # 删除旧布局
            old_layout = self.layout()
            self.setLayout(None)
            old_layout.deleteLater()
        
        # 主布局
        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(20, 20, 20, 20)
        self.main_layout.setSpacing(15)
        
        # 顶部布局（Logo和信息）
        top_layout = QHBoxLayout()
        top_layout.setSpacing(15)
        
        # Logo区域
        if self.logo_path:
            logo_container = QFrame()
            logo_container.setFixedSize(150, 70)
            logo_container.setStyleSheet("""
                QFrame {
                    background-color: #F5F5F5;
                    border-radius: 8px;
                }
            """)
            
            logo_layout = QVBoxLayout(logo_container)
            logo_layout.setContentsMargins(10, 5, 10, 5)
            logo_layout.setAlignment(Qt.AlignCenter)
            
            logo_label = QLabel()
            logo_pixmap = QPixmap(self.logo_path)
            scaled_pixmap = logo_pixmap.scaled(130, 60, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            logo_label.setPixmap(scaled_pixmap)
            logo_label.setAlignment(Qt.AlignCenter)
            
            logo_layout.addWidget(logo_label)
            top_layout.addWidget(logo_container)
        
        # 信息区域
        info_layout = QVBoxLayout()
        info_layout.setSpacing(5)
        
        self.title_label = QLabel(self.title)
        self.title_label.setProperty("class", "title")
        self.font_pages_manager.apply_title_style(self.title_label)
        
        self.version_label = QLabel(self.version)
        self.version_label.setProperty("class", "version")
        self.font_pages_manager.apply_small_style(self.version_label)
        
        self.related_info_label = QLabel(self.related_info)
        self.related_info_label.setProperty("class", "related-info")
        self.font_pages_manager.apply_small_style(self.related_info_label)
        
        info_layout.addWidget(self.title_label)
        info_layout.addWidget(self.version_label)
        info_layout.addWidget(self.related_info_label)
        info_layout.addStretch()
        
        top_layout.addLayout(info_layout)
        top_layout.addStretch()
        
        self.main_layout.addLayout(top_layout)
        
        # 链接按钮
        if self.link_text and self.link_url:
            button_layout = QHBoxLayout()
            button_layout.setAlignment(Qt.AlignRight)
            
            self.link_button = WhiteButton(title=self.link_text, icon=self.font_manager.get_icon_text("link"))
            self.link_button.clicked.connect(self._open_link)
            
            button_layout.addWidget(self.link_button)
            self.main_layout.addLayout(button_layout)
    
    def _open_link(self):
        try:
            QDesktopServices.openUrl(QUrl(self.link_url))
            log.info(f"打开链接: {self.link_url}")
        except Exception as e:
            log.error(f"打开链接失败: {str(e)}")
        
    def update_content(self, title=None, version=None, related_info=None, link_text=None, link_url=None, logo_path=None):
        content_changed = False
        
        if title is not None and self.title != title:
            self.title = title
            content_changed = True
            
        if version is not None and self.version != version:
            self.version = version
            content_changed = True
            
        if related_info is not None and self.related_info != related_info:
            self.related_info = related_info
            content_changed = True
            
        if link_text is not None and self.link_text != link_text:
            self.link_text = link_text
            content_changed = True
            
        if link_url is not None and self.link_url != link_url:
            self.link_url = link_url
            content_changed = True
            
        if logo_path is not None and self.logo_path != logo_path:
            self.logo_path = logo_path
            content_changed = True
        
        # 如果内容有变化，重新设置UI
        if content_changed:
            self.setup_ui()
        # 如果内容没有变化但UI组件已存在，直接更新文本
        elif self.title_label and self.version_label and self.related_info_label:
            self.title_label.setText(self.title)
            self.version_label.setText(self.version)
            self.related_info_label.setText(self.related_info)
            if self.link_button:
                self.link_button.update_title(self.link_text)
    
    def update_text(self):
        pass  # 由调用者处理文本更新 