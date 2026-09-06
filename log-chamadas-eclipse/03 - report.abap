REPORT zadt_export_log.

TYPES:
  ty_t_header_fields TYPE STANDARD TABLE OF ihttpnvp WITH DEFAULT KEY,

  BEGIN OF ty_request_json,
    request_line  TYPE sadt_rest_request_line,
    header_fields TYPE ty_t_header_fields,
    message_body  TYPE string,
  END OF ty_request_json,

  BEGIN OF ty_response_json,
    status_line   TYPE sadt_rest_status_line,
    header_fields TYPE ty_t_header_fields,
    message_body  TYPE string,
  END OF ty_response_json,

  BEGIN OF ty_json,
    request  TYPE ty_request_json,
    response TYPE ty_response_json,
  END OF ty_json,

  BEGIN OF ty_export,
    logid TYPE zadt_log-logid,
    json  TYPE ty_json,
  END OF ty_export,

  ty_t_export TYPE STANDARD TABLE OF ty_export WITH DEFAULT KEY.

PARAMETERS:
  p_file  TYPE string LOWER CASE OBLIGATORY,
  p_clear AS CHECKBOX.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_file.

  DATA:
    lv_filename TYPE string,
    lv_path     TYPE string,
    lv_fullpath TYPE string,
    lv_result   TYPE i.

  cl_gui_frontend_services=>file_save_dialog(
    EXPORTING
      window_title      = 'Salvar arquivo JSON'
      default_extension = 'json'
      default_file_name = 'zadt_log.json'
      file_filter       = 'JSON (*.json)|*.json|'
    CHANGING
      filename          = lv_filename
      path              = lv_path
      fullpath          = lv_fullpath
      user_action       = lv_result
    EXCEPTIONS
      OTHERS            = 1
  ).

  IF sy-subrc = 0
     AND lv_result = cl_gui_frontend_services=>action_ok.

    p_file = lv_fullpath.

  ENDIF.

START-OF-SELECTION.

  DATA:
    lt_log            TYPE STANDARD TABLE OF zadt_log,
    ls_log            TYPE zadt_log,
    ls_json           TYPE ty_json,
    lt_export         TYPE ty_t_export,
    ls_export         TYPE ty_export,
    lt_file           TYPE STANDARD TABLE OF string,
    lv_json_export    TYPE string,
    lv_request_text   TYPE string,
    lv_response_text  TYPE string,
    lv_request_xstr   TYPE xstring,
    lv_response_xstr  TYPE xstring,
    lo_request_conv   TYPE REF TO cl_abap_conv_in_ce,
    lo_response_conv  TYPE REF TO cl_abap_conv_in_ce.

  SELECT *
    FROM zadt_log
    INTO TABLE @lt_log
    ORDER BY logid.

  IF lt_log IS INITIAL.

    MESSAGE 'Nenhum log encontrado para exportação' TYPE 'S'.
    RETURN.

  ENDIF.

  LOOP AT lt_log INTO ls_log.

    CLEAR:
      ls_json,
      ls_export,
      lv_request_text,
      lv_response_text,
      lv_request_xstr,
      lv_response_xstr,
      lo_request_conv,
      lo_response_conv.

    TRY.

        /ui2/cl_json=>deserialize(
          EXPORTING
            json = ls_log-json
          CHANGING
            data = ls_json
        ).

      CATCH cx_root.

        MESSAGE 'Erro ao processar JSON da tabela ZADT_LOG' TYPE 'E'.

    ENDTRY.

    IF ls_json-request-message_body IS NOT INITIAL.

      TRY.

          lv_request_xstr =
            cl_http_utility=>decode_x_base64(
              encoded = ls_json-request-message_body
            ).

          lo_request_conv =
            cl_abap_conv_in_ce=>create(
              input    = lv_request_xstr
              encoding = 'UTF-8'
            ).

          lo_request_conv->read(
            IMPORTING
              data = lv_request_text
          ).

          ls_json-request-message_body = lv_request_text.

        CATCH cx_root.

      ENDTRY.

    ENDIF.

    IF ls_json-response-message_body IS NOT INITIAL.

      TRY.

          lv_response_xstr =
            cl_http_utility=>decode_x_base64(
              encoded = ls_json-response-message_body
            ).

          lo_response_conv =
            cl_abap_conv_in_ce=>create(
              input    = lv_response_xstr
              encoding = 'UTF-8'
            ).

          lo_response_conv->read(
            IMPORTING
              data = lv_response_text
          ).

          ls_json-response-message_body = lv_response_text.

        CATCH cx_root.

      ENDTRY.

    ENDIF.

    ls_export-logid = ls_log-logid.
    ls_export-json  = ls_json.

    APPEND ls_export TO lt_export.

  ENDLOOP.

  lv_json_export = /ui2/cl_json=>serialize(
    data          = lt_export
    compress      = abap_false
    format_output = abap_true
  ).

  APPEND lv_json_export TO lt_file.

  cl_gui_frontend_services=>gui_download(
    EXPORTING
      filename = p_file
      filetype = 'ASC'
      codepage = '4110'
    CHANGING
      data_tab = lt_file
    EXCEPTIONS
      OTHERS   = 1
  ).

  IF sy-subrc <> 0.

    MESSAGE 'Erro ao exportar arquivo JSON. A tabela não foi limpa' TYPE 'E'.

  ENDIF.

  IF p_clear = abap_true.

    DELETE FROM zadt_log.

    IF sy-subrc <> 0.

      ROLLBACK WORK.

      MESSAGE 'Arquivo exportado, mas ocorreu erro ao limpar a tabela' TYPE 'E'.

    ENDIF.

    COMMIT WORK.

  ENDIF.

  MESSAGE 'Exportação realizada com sucesso' TYPE 'S'.