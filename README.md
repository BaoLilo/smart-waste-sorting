Phân Loại Rác Thải Thông Minh (Smart Waste Sorting)

Ứng dụng web nhận diện và phân loại rác thải theo thời gian thực qua camera hoặc ảnh tải lên, sử dụng MobileNetV2 (Transfer Learning & Fine-tuning) kết hợp TensorFlow.js chạy hoàn toàn trên trình duyệt.

Demo trực tuyến (GitHub Pages): https://baolilo.github.io/smart-waste-sorting/

1. Thông tin đồ án

Môn học: Học Máy (Machine Learning)

Giảng viên hướng dẫn: ThS. Nguyễn Thái Anh

Nhóm thực hiện: Nhóm 12

Nguyễn Trần Khôi Vĩ

Châu Gia Bảo

2. Tính năng chính

Nhận diện thời gian thực qua camera: Hỗ trợ camera trước/sau, chế độ lật gương, toàn màn hình và tự động phát hiện thiếu sáng.

Tải ảnh lên để kiểm tra: Hỗ trợ phân loại trực tiếp từ ảnh tĩnh trên máy tính hoặc điện thoại.

Tăng cường độ chính xác trên trình duyệt:

Dùng COCO-SSD tự động định vị và cắt sát vùng vật thể rác (loại bỏ nền thừa và người).

Chạy MobileNetV2 (TrashNet) kết hợp Test-Time Augmentation (lật ngang) và phối hợp ngữ nghĩa (ensemble) cùng MobileNetV2 ImageNet.

Làm mượt kết quả qua nhiều khung hình liên tiếp (SMOOTH = 5), yêu cầu vượt ngưỡng tin cậy và độ chênh lệch tối thiểu (MIN_MARGIN = 0.2) trước khi chốt kết quả.

Hỗ trợ người dùng & thống kê:

Hiển thị xác suất từng lớp, hướng dẫn chọn thùng rác tương ứng.

Thống kê số lượng rác theo phiên, lưu lịch sử phân loại và hỗ trợ xuất tệp CSV.

Đọc to kết quả bằng giọng nói tiếng Việt (Web Speech API), chuyển đổi giao diện Sáng/Tối.

Phím tắt nhanh: Space (bật/tắt camera), F (toàn màn hình), T (đổi giao diện).

Bảo mật & riêng tư: Toàn bộ quá trình suy luận AI diễn ra cục bộ trên trình duyệt, hình ảnh không gửi lên máy chủ.

3. Dữ liệu & Kết quả huấn luyện mô hình

Bộ dữ liệu: TrashNet gồm 2.527 ảnh thuộc 6 lớp: cardboard (bìa carton), glass (thủy tinh), metal (kim loại), paper (giấy), plastic (nhựa), trash (rác còn lại).

Chia tập dữ liệu: 80% huấn luyện (2.022 ảnh) / 20% kiểm thử (505 ảnh).

Kiến trúc: MobileNetV2 tiền huấn luyện trên ImageNet, huấn luyện 2 giai đoạn (đóng băng trọng số và tinh chỉnh fine-tuning 40 lớp cuối), sau đó chuyển đổi sang định dạng TensorFlow.js (model.json và các tệp trọng số .bin).

Độ chính xác trên tập kiểm thử (Validation Accuracy): 80,59% (407 / 505 ảnh dự đoán đúng).

Ma trận nhầm lẫn (Confusion Matrix)

4. Cấu trúc thư mục

smart-waste-sorting/
├── index.html                  # Giao diện chính của ứng dụng web
├── css/
│   └── style.css               # Định kiểu giao diện (Sáng/Tối, Responsive)
├── js/
│   ├── config.js               # Cấu hình đường dẫn mô hình, 6 lớp rác và tham số ngưỡng
│   ├── classifier.js           # Tải mô hình, tiền xử lý, COCO-SSD + MobileNetV2 Ensemble
│   └── app.js                  # Điều khiển camera, luồng dự đoán, thống kê, lịch sử, xuất CSV
├── model/
│   ├── model.json              # Cấu trúc mô hình TensorFlow.js
│   ├── group1-shard1of3.bin    # Trọng số mô hình (phần 1/3)
│   ├── group1-shard2of3.bin    # Trọng số mô hình (phần 2/3)
│   ├── group1-shard3of3.bin    # Trọng số mô hình (phần 3/3)
│   ├── waste_mobilenetv2_finetuned.keras
│   ├── waste_mobilenetv2.h5
│   └── patch.py
├── confusion_matrix.png        # Biểu đồ ma trận nhầm lẫn trên 505 ảnh kiểm thử
├── .gitignore                  # Danh sách tệp bỏ qua khi đẩy Git
└── README.md                   # Tài liệu giới thiệu dự án


5. Hướng dẫn chạy cục bộ (Local)

Do trình duyệt chặn tải mô hình qua giao thức file:// và yêu cầu ngữ cảnh bảo mật cho camera, bạn cần chạy qua một máy chủ HTTP cục bộ (Local Server):

# 1. Tải mã nguồn về máy
git clone https://github.com/BaoLilo/smart-waste-sorting.git
cd smart-waste-sorting

# 2. Khởi chạy máy chủ cục bộ bằng Python
python3 -m http.server 8000


Sau đó mở trình duyệt và truy cập địa chỉ: http://localhost:8000 (hoặc dùng tiện ích Live Server trong VS Code).

6. Công nghệ sử dụng

Deep Learning: TensorFlow / Keras (MobileNetV2)

Triển khai Web AI: TensorFlow.js (@tensorflow/tfjs), @tensorflow-models/coco-ssd, @tensorflow-models/mobilenet

Frontend: HTML5, CSS3, Vanilla JavaScript

Triển khai trực tuyến: GitHub Pages