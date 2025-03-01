from PySide6.QtWidgets import QLabel, QFrame, QVBoxLayout
from PySide6.QtCore import Qt
from core.font.font_pages_manager import FontPagesManager
from core.i18n import i18n
from core.log.log_manager import log

class DisclaimerText(QFrame):
    """
    免责声明文本组件
    用于显示免责声明文本
    """
    
    def __init__(self, text="", parent=None):
        super().__init__(parent)
        self.text = text
        self.font_manager = FontPagesManager()
        
        # 创建UI组件引用
        self.text_label = None
        self.main_layout = None
        
        self.setup_ui()
        
        # 连接语言变更信号
        i18n.language_changed.connect(self.update_text)
        
    def setup_ui(self):
        # 设置样式
        self.setStyleSheet("""
            DisclaimerText {
                background: transparent;
            }
            QLabel {
                color: #666666;
                background: transparent;
                font-size: 13px;
                line-height: 1.5;
            }
        """)
        
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
        self.main_layout.setContentsMargins(10, 10, 10, 10)
        self.main_layout.setSpacing(0)
        
        # 文本标签
        self.text_label = QLabel(self.text)
        self.text_label.setWordWrap(True)
        self.text_label.setAlignment(Qt.AlignLeft)
        self.font_manager.apply_small_style(self.text_label)
        
        self.main_layout.addWidget(self.text_label)
        
    def update_content(self, text):
        """更新文本内容"""
        if text is not None and self.text != text:
            self.text = text
            # 如果标签已存在，直接更新文本
            if self.text_label:
                self.text_label.setText(text)
            else:
                # 否则重新设置UI
                self.setup_ui()
    
    def update_text(self):
        """更新文本（用于国际化）"""
        pass  # 由调用者处理文本更新 