from PySide6.QtWidgets import (QFrame, QLabel, QVBoxLayout, QGraphicsDropShadowEffect, 
                             QHBoxLayout, QWidget, QPushButton, QSizePolicy)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QPixmap
from core.font.font_manager import FontManager
from core.font.font_pages_manager import FontPagesManager
from core.ui.card_shadow import CardShadow
from core.i18n import i18n
from core.log.log_manager import log

class AboutCard(QFrame):
    """
    关于页面的信息卡片组件
    用于显示标题、版本、构建日期和链接按钮等信息
    """
    
    def __init__(self, title="", version="", build_date="", dev_info="", logo_path=None, parent=None):
        super().__init__(parent)
        self.title = title
        self.version = version
        self.build_date = build_date
        self.dev_info = dev_info
        self.logo_path = logo_path
        
        self.font_manager = FontManager()
        self.font_pages_manager = FontPagesManager()
        
        # 创建UI组件引用
        self.title_label = None
        self.version_label = None
        self.build_date_label = None
        self.dev_info_label = None
        self.main_layout = None
        
        self.setup_ui()
        
        # 连接语言变更信号
        i18n.language_changed.connect(self.update_text)
        
    def setup_ui(self):
        # 设置卡片样式
        self.setStyleSheet("""
            AboutCard {
                background-color: #0D3B66;
                border-radius: 12px;
                color: white;
            }
            QLabel {
                color: white;
                background: transparent;
            }
            QLabel[class="title"] {
                font-size: 18px;
                font-weight: 600;
            }
            QLabel[class="version"] {
                font-size: 14px;
                opacity: 0.8;
            }
            QLabel[class="build-date"] {
                font-size: 14px;
                opacity: 0.8;
            }
            QLabel[class="dev-info"] {
                font-size: 14px;
                opacity: 0.8;
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
        self.main_layout.setSpacing(10)
        
        # 顶部布局（Logo和信息）
        top_layout = QHBoxLayout()
        top_layout.setSpacing(15)
        
        # Logo区域
        if self.logo_path:
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
                logo_pixmap = QPixmap(self.logo_path)
                if logo_pixmap.isNull():
                    log.error(f"无法加载Logo图片: {self.logo_path}")
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
        
        self.title_label = QLabel(self.title)
        self.title_label.setProperty("class", "title")
        self.font_pages_manager.apply_title_style(self.title_label)
        
        self.version_label = QLabel(self.version)
        self.version_label.setProperty("class", "version")
        self.font_pages_manager.apply_small_style(self.version_label)
        
        self.build_date_label = QLabel(self.build_date)
        self.build_date_label.setProperty("class", "build-date")
        self.font_pages_manager.apply_small_style(self.build_date_label)
        
        self.dev_info_label = QLabel(self.dev_info)
        self.dev_info_label.setProperty("class", "dev-info")
        self.font_pages_manager.apply_small_style(self.dev_info_label)
        
        info_layout.addWidget(self.title_label)
        info_layout.addWidget(self.version_label)
        info_layout.addWidget(self.build_date_label)
        info_layout.addWidget(self.dev_info_label)
        info_layout.addStretch()
        
        top_layout.addLayout(info_layout)
        top_layout.addStretch()
        
        self.main_layout.addLayout(top_layout)
        
    def update_content(self, title=None, version=None, build_date=None, dev_info=None, logo_path=None):
        """更新卡片内容"""
        content_changed = False
        
        if title is not None and self.title != title:
            self.title = title
            content_changed = True
            
        if version is not None and self.version != version:
            self.version = version
            content_changed = True
            
        if build_date is not None and self.build_date != build_date:
            self.build_date = build_date
            content_changed = True
            
        if dev_info is not None and self.dev_info != dev_info:
            self.dev_info = dev_info
            content_changed = True
            
        if logo_path is not None and self.logo_path != logo_path:
            self.logo_path = logo_path
            content_changed = True
        
        # 如果内容有变化，重新设置UI
        if content_changed:
            self.setup_ui()
        # 如果内容没有变化但UI组件已存在，直接更新文本
        elif self.title_label and self.version_label and self.build_date_label and self.dev_info_label:
            self.title_label.setText(self.title)
            self.version_label.setText(self.version)
            self.build_date_label.setText(self.build_date)
            self.dev_info_label.setText(self.dev_info)
    
    def update_text(self):
        """更新文本（用于国际化）"""
        pass  # 由调用者处理文本更新 